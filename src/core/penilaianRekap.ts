import { sanitizeValue } from './template';

/**
 * REKAP ASESMEN AWAL KEPERAWATAN -- perakit pesannya. Fungsi murni, tanpa
 * database, supaya pratinjau di dashboard dan pesan yang benar-benar dikirim
 * worker memakai penurunan yang SAMA.
 *
 * Pratinjau yang berbeda dari kenyataan lebih buruk daripada tanpa pratinjau:
 * staf menyetel isi pesan sambil melihat bentuk yang tidak pernah terkirim, lalu
 * menyimpulkan fiturnya rusak saat yang tiba di grup ternyata lain.
 */

export type StatusPenilaian = 'belum' | 'sebagian' | 'lengkap';

/**
 * Bentuk barisnya dibuat STRUKTURAL, bukan mengimpor `BarisPenilaian` dari
 * `khanza/penilaianAwal.ts` -- modul itu menarik koneksi database, dan modul ini
 * harus bisa diuji tanpa MariaDB hidup. Tipe aslinya memenuhi bentuk ini apa
 * adanya. Pola `core/broadcastVars.ts` dan `core/suratOtomatis.ts`.
 */
export interface BarisRekap {
  noRawat: string;
  noRkmMedis: string;
  namaPasien: string | null;
  jamReg: string | null;
  namaPoli: string | null;
  status: StatusPenilaian;
  kosong: readonly string[];
}

export type RincianRekap = 'penuh' | 'ringkas';

/** Batas karakter satu pesan, DIUKUR di migrations/022 lewat kiriman sungguhan. */
export const BATAS_KARAKTER_PESAN = 12000;

export const JAM_PENILAIAN_BAWAAN = '13:00,19:30';

/** Nama yang enak dibaca untuk kolom vital Khanza yang singkatannya tidak jelas. */
const NAMA_KOLOM: Record<string, string> = {
  td: 'tekanan darah',
  nadi: 'nadi',
  suhu: 'suhu',
  rr: 'pernapasan',
  gcs: 'GCS',
  bb: 'berat badan',
  tb: 'tinggi badan',
  keluhan_utama: 'keluhan utama',
};

/**
 * Satu baris pasien di dalam daftar.
 *
 * `sanitizeValue()` dipanggil untuk `namaPasien` dan `namaPoli` -- keduanya
 * INPUT BEBAS petugas pendaftaran Khanza. Ini SYARAT, bukan kehati-hatian:
 * `{daftar_pasien}` masuk `MULTILINE_VARIABLES`, yang berarti ia DIKECUALIKAN
 * dari sanitasi `renderTemplate()`. Tanpa panggilan di sini, nama pasien yang
 * memuat baris baru bisa menyisipkan barisnya sendiri ke dalam pesan.
 *
 * Nomor rekam medis TIDAK disanitasi karena ia bukan teks bebas -- tapi ia tetap
 * lewat `String()` supaya bentuk apa pun dari database tidak meledak.
 */
function barisPasien(b: BarisRekap): string {
  const nama = sanitizeValue(b.namaPasien ?? '') || '(nama tidak tercatat)';
  const jam = b.jamReg ? ` (${String(b.jamReg).slice(0, 5)})` : '';
  if (b.status === 'belum') return `- ${nama} / ${b.noRkmMedis}${jam} - belum diisi`;

  const kurang = b.kosong.map((k) => NAMA_KOLOM[k] ?? k).join(', ');
  return `- ${nama} / ${b.noRkmMedis}${jam} - belum: ${kurang}`;
}

export interface RingkasRekapPenilaian {
  tanggal: string;
  total: number;
  belum: number;
  sebagian: number;
  lengkap: number;
  perluDiisi: readonly BarisRekap[];
}

/**
 * Daftar pasien yang perlu ditindaklanjuti, dikelompokkan menurut golongannya.
 *
 * DUA kelompok terpisah, bukan satu daftar berurut, karena tindakannya berbeda:
 * "belum diisi" berarti asesmennya belum dibuat sama sekali, "terisi sebagian"
 * berarti tinggal melengkapi yang kurang. Satu daftar campuran memaksa
 * pembacanya membaca ekor tiap baris untuk tahu mana yang mana.
 *
 * `maxBaris` memotong, dan sisanya DISEBUT jumlahnya -- tidak pernah dibuang
 * diam-diam. Daftar yang tergunting tanpa keterangan terlihat persis seperti
 * daftar yang utuh, dan pembacanya menyimpulkan pekerjaannya sudah selesai
 * (pelajaran migrations/022: batas 200 baris darurat stok yang menggigit di hari
 * pertama).
 */
export function formatDaftarPasien(
  perluDiisi: readonly BarisRekap[],
  rincian: RincianRekap,
  maxBaris: number,
): string {
  if (perluDiisi.length === 0) return '';
  if (rincian === 'ringkas') return '';

  const belum = perluDiisi.filter((b) => b.status === 'belum');
  const sebagian = perluDiisi.filter((b) => b.status === 'sebagian');

  const batas = Number.isFinite(maxBaris) && maxBaris > 0 ? maxBaris : Infinity;
  const bagian: string[] = [];
  let terpakai = 0;

  for (const [judul, daftar] of [
    ['Belum diisi', belum],
    ['Terisi sebagian', sebagian],
  ] as const) {
    if (daftar.length === 0) continue;
    const sisaJatah = batas - terpakai;
    if (sisaJatah <= 0) {
      bagian.push(`*${judul}* (${daftar.length})\n- dan ${daftar.length} pasien lain`);
      continue;
    }
    const tampil = daftar.slice(0, sisaJatah);
    terpakai += tampil.length;
    const baris = tampil.map(barisPasien);
    const sisa = daftar.length - tampil.length;
    if (sisa > 0) baris.push(`- dan ${sisa} pasien lain`);
    bagian.push(`*${judul}* (${daftar.length})\n${baris.join('\n')}`);
  }

  return bagian.join('\n\n');
}

/**
 * Variabel untuk `renderTemplate()`.
 *
 * `jumlah_perlu_diisi` DITURUNKAN (belum + sebagian), tidak pernah di-query
 * sendiri -- alasan yang sama yang membuat `{jumlah_belum_serah}` diturunkan di
 * rekap resep: dua angka yang dihitung terpisah bisa berhenti berjumlah, dan
 * rekap yang tidak berjumlah berhenti dipercaya seluruhnya, bukan sebagian.
 */
export function varsRekapPenilaian(
  r: RingkasRekapPenilaian,
  rincian: RincianRekap,
  maxBaris: number,
): Record<string, string> {
  return {
    tanggal_rekap: r.tanggal,
    jumlah_total: String(r.total),
    jumlah_belum: String(r.belum),
    jumlah_sebagian: String(r.sebagian),
    jumlah_lengkap: String(r.lengkap),
    jumlah_perlu_diisi: String(r.belum + r.sebagian),
    daftar_pasien: formatDaftarPasien(r.perluDiisi, rincian, maxBaris),
  };
}

/**
 * Apakah hari itu menuntut tindakan apa pun.
 *
 * Ditentukan JUMLAH YANG PERLU DIISI, bukan jumlah pasiennya: hari tanpa satu
 * pun pasien baru dan hari yang seluruh asesmennya sudah lengkap sama-sama tidak
 * menuntut apa pun dari perawat. Membedakan keduanya cuma menghasilkan dua
 * pesan "tidak ada apa-apa" yang berbeda kalimat.
 */
export function rekapKosong(r: RingkasRekapPenilaian): boolean {
  return r.belum + r.sebagian === 0;
}

/**
 * Memecah teks DAFTAR yang melewati batas karakter, memotong pada batas BARIS.
 *
 * Yang dipecah adalah DAFTARNYA, bukan pesan yang sudah dirender -- pola yang
 * sama dengan `pecahDaftarDarurat()`. Bedanya penting: tiap bagian lalu dirender
 * ulang lewat templatenya sendiri, jadi pembuka dan penutup yang ditulis staf
 * (nama RS, kalimat "Mohon dilengkapi melalui SIMRS") ikut di SETIAP bagian.
 * Memecah pesan jadi menghasilkan bagian kedua yang dibuka potongan daftar
 * telanjang, tanpa keterangan apa pun tentang apa yang sedang dibacanya.
 *
 * Panjangnya ditangani lewat pemecahan, bukan pemotongan -- pelajaran
 * migrations/022. Daftar ini daftar PEKERJAAN: pasien ke-41 tetap harus
 * diasesmen, jadi menggunting ekornya berarti pekerjaan yang hilang tanpa ada
 * yang tahu.
 *
 * Memotong pada batas baris, bukan karakter, supaya tidak ada nama pasien yang
 * terbelah dua pesan.
 */
export function pecahPesan(teks: string, batas = BATAS_KARAKTER_PESAN): string[] {
  if (teks.length <= batas) return [teks];

  const bagian: string[] = [];
  let kini = '';
  for (const baris of teks.split('\n')) {
    // Baris tunggal yang sendirian sudah melewati batas tetap dikirim apa
    // adanya: memecahnya di tengah karakter akan membelah sebuah nama.
    if (kini && kini.length + 1 + baris.length > batas) {
      bagian.push(kini);
      kini = baris;
    } else {
      kini = kini ? `${kini}\n${baris}` : baris;
    }
  }
  if (kini) bagian.push(kini);
  return bagian;
}

/**
 * Vars untuk SETIAP bagian pesan. Selalu berisi minimal satu.
 *
 * Angka rekapnya (`jumlah_*`) sama di seluruh bagian dan itu disengaja: ia
 * menjawab "berapa banyak seluruhnya", bukan "berapa di bagian ini". Yang
 * berganti hanya `{daftar_pasien}`.
 */
export function varsBagianRekap(
  r: RingkasRekapPenilaian,
  rincian: RincianRekap,
  maxBaris: number,
  batasKarakter = BATAS_KARAKTER_PESAN,
): Record<string, string>[] {
  const dasar = varsRekapPenilaian(r, rincian, maxBaris);
  const potongan = pecahPesan(dasar.daftar_pasien ?? '', batasKarakter);
  return potongan.map((daftar, i) => ({
    ...dasar,
    daftar_pasien: i === 0 ? daftar : `*(lanjutan)*\n${daftar}`,
  }));
}
