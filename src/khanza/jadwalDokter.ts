import { sikSelect } from '@/db/sik';
import { registerPlanCheck } from './planChecks';
import { sanitizeValue } from '@/core/template';

/**
 * Jadwal praktik dokter -- sumber data untuk {jadwal_dokter},
 * {jadwal_hari_ini}, dan {daftar_poli} pada BALASAN OTOMATIS.
 *
 * Ini satu-satunya modul khanza/ yang TIDAK membaca kejadian satu pasien.
 * Yang dibaca adalah tabel konfigurasi layanan (`jadwal`, `dokter`,
 * `poliklinik`) -- informasi yang memang diumumkan rumah sakit di papan
 * pengumuman dan situsnya. Tidak ada kolom milik pasien mana pun yang
 * disentuh, jadi pemeriksaan privasi per-pasien (core/privacy.ts) tidak
 * berlaku di sini; yang berlaku adalah penyaringan poli sensitif di bawah.
 */

/** Persis nilai enum `jadwal.hari_kerja` di Khanza -- 'AKHAD', bukan 'MINGGU'. */
export const HARI_KERJA = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'AKHAD'] as const;
export type HariKerja = (typeof HARI_KERJA)[number];

/**
 * Khanza menamai hari Minggu 'AKHAD'. Pasien tidak menyebutnya begitu, jadi
 * yang ditulis di pesan adalah "Minggu" -- kode enumnya tetap apa adanya di
 * query supaya tidak ada penerjemahan dua arah yang bisa meleset.
 */
const HARI_LABEL: Record<HariKerja, string> = {
  SENIN: 'Senin',
  SELASA: 'Selasa',
  RABU: 'Rabu',
  KAMIS: 'Kamis',
  JUMAT: 'Jumat',
  SABTU: 'Sabtu',
  AKHAD: 'Minggu',
};

/** JS getDay(): 0 = Minggu. Zona waktu server diasumsikan WIB, sama seperti seluruh proyek. */
export function hariKerjaOf(date: Date): HariKerja {
  return (['AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'] as const)[date.getDay()]!;
}

export interface JadwalRow {
  kdDokter: string;
  namaDokter: string;
  kdPoli: string | null;
  namaPoli: string | null;
  hariKerja: HariKerja;
  jamMulai: string;
  jamSelesai: string | null;
}

export interface JadwalQuery {
  /** Diisi hanya bila pasien menyebut poli tertentu (core/autoReply.ts detectPoli). */
  kdPoli?: string | null;
  hariKerja?: HariKerja | null;
  /**
   * privacy.sensitive_poli_codes. Diabaikan bila `kdPoli` diisi -- lihat
   * catatan panjang di buildJadwalSql().
   */
  excludeKdPoli?: readonly string[];
  limit: number;
}

interface JadwalDbRow {
  kd_dokter: string;
  nm_dokter: string | null;
  kd_poli: string | null;
  nm_poli: string | null;
  hari_kerja: HariKerja;
  jam_mulai: string;
  jam_selesai: string | null;
}

export function buildJadwalSql(q: JadwalQuery): { sql: string; replacements: Record<string, unknown> } {
  // Dua penyaring status, dan KEDUANYA perlu. Baris `jadwal` tidak ikut
  // terhapus saat dokter berhenti atau poli ditutup -- pada database di sini
  // Poliklinik Mata sudah status='0' tapi masih menyimpan dua baris jadwal.
  // Tanpa penyaring poli, balasan otomatis akan menyuruh pasien datang ke poli
  // yang sudah tidak dilayani rumah sakit. Ditemukan saat pengujian terhadap
  // sik sungguhan, bukan diperkirakan.
  //
  // kd_poli boleh NULL (jadwal dokter yang tidak terikat poli) -- baris itu
  // tetap ditampilkan selama dokternya aktif.
  const where: string[] = ["d.status = '1'", "(j.kd_poli IS NULL OR p.status = '1')"];
  const replacements: Record<string, unknown> = { limit: q.limit };

  if (q.kdPoli) {
    // Pasien menyebut poli ini secara eksplisit, jadi penyaringan poli sensitif
    // di bawah sengaja TIDAK ikut dipasang. Alasannya: daftar poli sensitif
    // (F4.3) ada untuk mencegah pesan yang membocorkan bahwa SEORANG PASIEN
    // berurusan dengan layanan itu -- bukan untuk merahasiakan bahwa layanannya
    // ada. Menyembunyikan jadwal dari orang yang menanyakannya dengan nama
    // hanya membuat pasien yang paling butuh justru tidak terlayani, tanpa
    // menambah kerahasiaan apa pun.
    where.push('j.kd_poli = :kdPoli');
    replacements.kdPoli = q.kdPoli;
  } else {
    // Sebaliknya, pada daftar UMUM poli sensitif dilewati: pasien yang cuma
    // bertanya "jadwal dokter" tidak perlu menerima kiriman berisi jadwal
    // layanan sensitif yang tidak ia minta, dan pesan WhatsApp bisa terbaca
    // orang lain di ponsel yang sama.
    if (q.excludeKdPoli && q.excludeKdPoli.length > 0) {
      where.push('(j.kd_poli IS NULL OR j.kd_poli NOT IN (:excludeKdPoli))');
      replacements.excludeKdPoli = [...q.excludeKdPoli];
    }
  }

  if (q.hariKerja) {
    where.push('j.hari_kerja = :hariKerja');
    replacements.hariKerja = q.hariKerja;
  }

  const sql = `
    SELECT j.kd_dokter, d.nm_dokter, j.kd_poli, p.nm_poli, j.hari_kerja, j.jam_mulai, j.jam_selesai
    FROM jadwal j
    JOIN dokter d ON d.kd_dokter = j.kd_dokter
    LEFT JOIN poliklinik p ON p.kd_poli = j.kd_poli
    WHERE ${where.join(' AND ')}
    ORDER BY FIELD(j.hari_kerja, 'SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','AKHAD'), j.jam_mulai, d.nm_dokter
    LIMIT :limit
  `;
  return { sql, replacements };
}

export async function fetchJadwalDokter(q: JadwalQuery): Promise<JadwalRow[]> {
  const { sql, replacements } = buildJadwalSql(q);
  const rows = await sikSelect<JadwalDbRow>(sql, replacements);
  return rows.map((r) => ({
    kdDokter: r.kd_dokter,
    namaDokter: r.nm_dokter ?? '',
    kdPoli: r.kd_poli,
    namaPoli: r.nm_poli,
    hariKerja: r.hari_kerja,
    jamMulai: r.jam_mulai,
    jamSelesai: r.jam_selesai,
  }));
}

export interface PoliRow {
  kdPoli: string;
  namaPoli: string;
}

/** Poli aktif yang PUNYA jadwal -- dipakai detectPoli, bukan seluruh isi tabel poliklinik. */
export async function fetchPoliWithJadwal(): Promise<PoliRow[]> {
  const rows = await sikSelect<{ kd_poli: string; nm_poli: string | null }>(`
    SELECT DISTINCT p.kd_poli, p.nm_poli
    FROM jadwal j
    JOIN poliklinik p ON p.kd_poli = j.kd_poli
    JOIN dokter d ON d.kd_dokter = j.kd_dokter
    WHERE p.status = '1' AND d.status = '1'
    ORDER BY p.nm_poli
  `);
  return rows.map((r) => ({ kdPoli: r.kd_poli, namaPoli: r.nm_poli ?? r.kd_poli }));
}

/** Seluruh poli aktif -- untuk {daftar_poli}, yaitu "layanan apa saja yang ada". */
export async function fetchPoliAktif(): Promise<PoliRow[]> {
  const rows = await sikSelect<{ kd_poli: string; nm_poli: string | null }>(
    "SELECT kd_poli, nm_poli FROM poliklinik WHERE status = '1' ORDER BY nm_poli",
  );
  return rows.map((r) => ({ kdPoli: r.kd_poli, namaPoli: r.nm_poli ?? r.kd_poli }));
}

/** '14:01:00' -> '14.01'. Titik, bukan titik dua -- konvensi jam Indonesia. */
export function formatJam(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  if (h === undefined || m === undefined) return time;
  return `${h.padStart(2, '0')}.${m}`;
}

function formatRentangJam(mulai: string, selesai: string | null): string {
  const a = formatJam(mulai);
  const b = formatJam(selesai);
  return b && b !== a ? `${a}-${b}` : `mulai ${a}`;
}

export interface FormatJadwalOptions {
  /** Total baris yang sebenarnya ada; bila > rows.length, ditambahkan catatan pemotongan. */
  truncatedFrom?: number;
  kontakRs?: string;
}

/**
 * Merangkai baris jadwal jadi teks WhatsApp, dikelompokkan per hari.
 *
 * `nm_dokter` dan `nm_poli` diketik petugas tanpa batasan format, sama seperti
 * `nm_pasien` (ARCHITECTURE §9.2) -- jadi keduanya dilewatkan sanitizeValue di
 * sini, satu per satu, SEBELUM dirangkai. Ini yang membuat hasil rangkaiannya
 * boleh dikecualikan dari sanitizeValue di renderTemplate (lihat
 * MULTILINE_VARIABLES di core/template.ts): baris baru pada hasil akhir semuanya
 * dipasang oleh kode ini, bukan datang dari isi kolom.
 */
export function formatJadwal(rows: readonly JadwalRow[], opts: FormatJadwalOptions = {}): string {
  if (rows.length === 0) return '';

  const byHari = new Map<HariKerja, JadwalRow[]>();
  for (const row of rows) {
    const list = byHari.get(row.hariKerja);
    if (list) list.push(row);
    else byHari.set(row.hariKerja, [row]);
  }

  const blocks: string[] = [];
  for (const hari of HARI_KERJA) {
    const list = byHari.get(hari);
    if (!list || list.length === 0) continue;
    const lines = list.map((r) => {
      const dokter = sanitizeValue(r.namaDokter);
      const poli = r.namaPoli ? sanitizeValue(r.namaPoli) : '';
      const jam = formatRentangJam(r.jamMulai, r.jamSelesai);
      return poli ? `- ${jam}  ${dokter} (${poli})` : `- ${jam}  ${dokter}`;
    });
    blocks.push(`*${HARI_LABEL[hari]}*\n${lines.join('\n')}`);
  }

  let text = blocks.join('\n\n');

  // Pemotongan diberi tahu, tidak dibiarkan senyap: jadwal yang terpotong diam-diam
  // membuat pasien menyimpulkan dokternya tidak praktik sama sekali.
  if (opts.truncatedFrom !== undefined && opts.truncatedFrom > rows.length) {
    const sisa = opts.truncatedFrom - rows.length;
    const kontak = opts.kontakRs ? ` Hubungi ${sanitizeValue(opts.kontakRs)} untuk jadwal lengkap.` : '';
    text += `\n\n(dan ${sisa} jadwal lain yang tidak muat di pesan ini.${kontak})`;
  }
  return text;
}

/** Daftar poli untuk {daftar_poli} -- satu nama per baris, sudah disanitasi. */
export function formatDaftarPoli(rows: readonly PoliRow[]): string {
  return rows.map((r) => `- ${sanitizeValue(r.namaPoli)}`).join('\n');
}

/**
 * §4.8: rencana query didaftarkan supaya `npm run verify:plans` ikut memeriksanya.
 *
 * allowFullScan DISENGAJA untuk query ini, dan alasannya berbeda dari
 * booking_registrasi. `jadwal` adalah tabel KONFIGURASI: barisnya sebanyak
 * (jumlah dokter x hari praktik), jadi ratusan pada rumah sakit besar dan tidak
 * bertambah seiring jumlah pasien. Aturan "wajib lewat indeks" ada karena tabel
 * TRANSAKSI Khanza (reg_periksa dan kerabatnya) tumbuh tanpa batas dan kolom
 * tanggalnya tidak terindeks -- itu tidak berlaku di sini. maxRows tetap dipasang
 * supaya asumsi "tabel ini kecil" gagal berisik kalau suatu saat ternyata keliru.
 */
registerPlanCheck({
  name: 'AUTOREPLY_JADWAL',
  sql: buildJadwalSql({ limit: 60 }).sql,
  replacements: buildJadwalSql({ limit: 60 }).replacements,
  allowFullScan: true,
  maxRows: 2000,
});
