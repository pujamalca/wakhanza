/**
 * Menyusun satu HIBAH OBAT & BHP jadi teks WhatsApp.
 *
 * Kembarannya `core/pengadaan.ts`: bentuk pesannya sama (kepala nota, daftar
 * barang, angka penutup) dan seluruh aturan bersamanya diambil dari
 * `core/notaBarang.ts`. Yang tinggal di sini adalah satu-satunya hal yang
 * benar-benar berbeda -- kolom nilainya, dan itu bukan perbedaan sepele.
 *
 * ==========================================================================
 * DUA nilai per barang, dan keduanya berarti hal yang berbeda
 * ==========================================================================
 *
 * Pembelian punya satu harga: yang dibayar. Hibah punya dua, dan Khanza memberi
 * keduanya nama sendiri di layar (`InventoryHibahObatBHP.java` baris 64-65):
 *
 *   h_hibah  / subtotalhibah    "Nilai Hibah (Rp)"   -- nilai yang DISEBUT pemberi
 *   h_diakui / subtotaldiakui   "Nilai Diakui (Rp)"  -- nilai yang DIAKUI rumah sakit
 *
 * Yang masuk buku adalah yang kedua: `totalnilai` (jumlah `subtotaldiakui`)
 * itulah yang dijurnal Khanza sebagai "PERSEDIAAN HIBAH OBAT & BHP" berpasangan
 * dengan "PENDAPATAN HIBAH". Karena itu nilai DIAKUI yang jadi angka utama di
 * tiap baris.
 *
 * Nilai yang disebut pemberi ditampilkan HANYA saat berbeda. Diukur atas seluruh
 * 14 baris rincian yang ada di database uji: keduanya sama persis di semua baris.
 * Mencetak dua angka identik pada tiap baris menggandakan panjang pesannya untuk
 * informasi nol, dan yang lebih buruk -- pembacanya berhenti memperhatikan
 * bedanya, sehingga selisih yang sungguhan (yang justru perlu ditanyakan ke
 * bagian akuntansi) ikut terlewat. Menyembunyikannya sama sekali salah ke arah
 * yang lain: selisih itu ADA gunanya justru karena jarang.
 *
 * ==========================================================================
 * Tidak ada satu pun data pasien di sini, dan tidak bisa ada
 * ==========================================================================
 *
 * `hibah_obat_bhp`/`detailhibah_obat_bhp` tidak punya satu kolom pun yang
 * menautkan sebuah penerimaan hibah dengan seorang pasien -- lihat komentar
 * pembuka `khanza/hibah.ts`.
 */
import { sanitizeValue } from './template';
import { isianSurat } from './suratDoc';
import { formatJumlah, formatRupiah, nilaiSama, pecahBarisBarang, kelompokkanPerNomor } from './notaBarang';

export interface BarisHibah {
  no_hibah: string;
  tgl_hibah: string | null;
  nama_pemberi: string | null;
  nama_petugas: string | null;
  nm_bangsal: string | null;
  /**
   * Kedua total header SELALU dibaca -- `farmasi.hibah_nilai` hanya memutus
   * nilai PER BARANG. Alasannya (baris label yang menggantung) ada di
   * `khanza/hibah.ts`, dan bentuknya sengaja sama dengan `{tagihan}` pengadaan.
   */
  totalhibah: number | null;
  /** Nilai yang diakui RS -- angka yang dijurnal Khanza sebagai PENDAPATAN HIBAH. */
  totalnilai: number | null;
}

export interface BarisDetailHibah {
  no_hibah: string;
  kode_brng: string;
  nama_brng: string | null;
  satuan: string | null;
  jumlah: number | null;
  /** Absen sama sekali bila `farmasi.hibah_nilai` mati -- bukan sekadar kosong. */
  h_hibah?: number | null;
  h_diakui?: number | null;
  subtotaldiakui?: number | null;
}

/**
 * Nama pemberi hibah, dengan penanda "tidak diisi" milik Khanza dibuang.
 *
 * `pemberihibah.nama_pemberi` berisi `'-'` pada baris H0001 di database uji --
 * pola yang sama persis dengan `penjab.png_jawab = '-'` (`core/penjamin.ts`) dan
 * dengan `pasien.pekerjaan = '-'` (`core/suratDoc.ts`). Diteruskan apa adanya,
 * notanya berbunyi "Asal hibah : -", yang bagi pembacanya terbaca seperti sistem
 * rusak.
 *
 * Memakai `isianSurat()` yang sudah ada alih-alih menyalin daftar penandanya ke
 * sini: daftar itu tumbuh dari pengamatan atas data Khanza yang sungguhan, dan
 * salinan ketiga adalah salinan yang paling mungkin ketinggalan saat penanda
 * berikutnya ditemukan. `core/suratDoc.ts` tidak mengimpor apa pun, jadi
 * memakainya dari sini tidak menarik ketergantungan baru.
 */
export function namaPemberiHibah(nama: string | null | undefined): string {
  return isianSurat(nama);
}

/**
 * Satu baris daftar barang hibah.
 *
 * `sanitizeValue()` untuk `nama_brng` DAN `satuan` adalah keharusan, bukan
 * kehati-hatian berlebih: keduanya diketik bebas petugas gudang di Khanza,
 * sementara hasil fungsi ini dipasang ke `{daftar_barang}` yang DIKECUALIKAN
 * dari sanitasi (MULTILINE_VARIABLES di `core/template.ts`). Setiap baris baru
 * pada hasil akhir wajib berasal dari kode di sini -- kalau tidak, satu nama
 * barang berisi baris baru bisa menyisipkan barisnya sendiri ke dalam pesan.
 * Persis lubang ARCHITECTURE §9.2.
 *
 * Nilai muncul HANYA bila kolomnya memang ikut di-SELECT. Diperiksa lewat
 * `undefined` pada `h_diakui`, bukan lewat flag terpisah: dengan begitu "nilai
 * tidak ditampilkan" dan "nilai tidak pernah dibaca dari sik" adalah satu
 * keadaan yang sama.
 */
function barisBarangHibahTeks(r: BarisDetailHibah): string {
  const nama = sanitizeValue(r.nama_brng ?? '') || r.kode_brng;
  const satuan = sanitizeValue(r.satuan ?? '');
  const jumlah = formatJumlah(r.jumlah);

  const bagian = [jumlah, satuan].filter(Boolean).join(' ');
  let teks = `• ${nama} — ${bagian || '-'}`;

  if (r.h_diakui !== undefined) {
    const diakui = formatRupiah(r.h_diakui);
    const subtotal = formatRupiah(r.subtotaldiakui);
    if (diakui) teks += ` @ ${diakui}`;
    if (subtotal) teks += ` = ${subtotal}`;

    // Hanya saat BERBEDA -- lihat alasannya di komentar pembuka berkas ini.
    if (!nilaiSama(r.h_hibah, r.h_diakui)) {
      const disebut = formatRupiah(r.h_hibah);
      if (disebut) teks += ` (disebut pemberi ${disebut})`;
    }
  }
  return teks;
}

/** Daftar barang hibah sebagai SATU ATAU BEBERAPA pesan. */
export function pecahDaftarBarangHibah(rows: BarisDetailHibah[], batasKarakter: number): string[] {
  return pecahBarisBarang(rows.map(barisBarangHibahTeks), batasKarakter);
}

/** Daftar lengkap dalam satu teks, tanpa pemecahan. Dipakai pratinjau dashboard. */
export function formatDaftarBarangHibah(rows: BarisDetailHibah[]): string {
  return pecahDaftarBarangHibah(rows, Number.POSITIVE_INFINITY)[0] ?? '';
}

/** Rincian dikelompokkan per nomor hibah. */
export function kelompokkanDetailHibah(rows: BarisDetailHibah[]): Map<string, BarisDetailHibah[]> {
  return kelompokkanPerNomor(rows, (r) => r.no_hibah);
}
