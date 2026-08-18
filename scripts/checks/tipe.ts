import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AKAR = join(__dirname, '..', '..');

export interface Temuan {
  /** Lintasan relatif terhadap akar repo, dengan garis miring maju. */
  berkas: string;
  /** 1-indeks. Dihilangkan bila temuannya tentang berkas yang TIDAK ADA. */
  baris?: number;
  pesan: string;
}

export interface Pemeriksaan {
  /** Kunci mesin, dipakai `npm run preflight -- <nama>` untuk menjalankan satu saja. */
  nama: string;
  /** Satu kalimat: apa yang dijaga. */
  judul: string;
  /**
   * Kenapa pemeriksaan ini ada -- dicetak HANYA saat ia menemukan sesuatu.
   * Temuan tanpa alasan berakhir "dibungkam" oleh orang yang tidak tahu apa
   * yang sedang dijaga, dan pagar yang dibungkam lebih buruk daripada pagar
   * yang tidak pernah ada: ia membuat orang berikutnya mengira sudah dijaga.
   */
  alasan: string;
  jalankan(): Temuan[];
}

/**
 * Berkas pemeriksa itu sendiri, DIKECUALIKAN dari seluruh pemindaian.
 *
 * Ia menyimpan pola dan kalimat alasan yang isinya justru contoh pelanggaran:
 * `bocor.ts` memuat pola nomor telepon, `data.ts` menulis '.sync()' di dalam
 * kalimat yang menerangkan kenapa .sync() dilarang. Tanpa pengecualian ini
 * pemeriksaannya menuduh dirinya sendiri, selalu merah, lalu dimatikan orang
 * berikutnya -- dan pagar yang dimatikan lebih buruk daripada pagar yang tidak
 * pernah ada, karena pembacanya mengira sudah dijaga.
 *
 * Ditaruh di SINI, bukan disalin ke tiap pemeriksa: dua tempat yang
 * memutuskan sendiri "berkas mana yang dilewati" adalah bentuk kegagalan yang
 * paling sering dibayar di proyek ini.
 */
const BERKAS_PEMERIKSA = /^scripts\/(?:checks\/|preflight\.ts$)/;

/**
 * Berkas yang IKUT git -- yang sudah terlacak DAN yang baru, bukan `readdir`.
 *
 * Bedanya menggigit tepat pada pemeriksaan kebocoran: `.env`, `.wwebjs_auth`,
 * dan skrip `.tmp-*.mts` penuh berisi kredensial dan data pasien ada di disk
 * tapi tidak pernah ikut ke repo. Memindainya lewat `readdir` berarti
 * pemeriksaan ini berbunyi setiap hari atas berkas yang memang tidak akan
 * pernah terbit -- dan peringatan yang berbunyi setiap hari berhenti dibaca.
 */
export function berkasTerlacak(): string[] {
  // `--others --exclude-standard` menambahkan berkas BARU yang belum di-add,
  // dan itu bukan kelengkapan melainkan inti gunanya: berkas yang baru ditulis
  // adalah yang PALING mungkin membawa nomor contoh hasil salin-tempel dari
  // database, dan menangkapnya sebelum ia pernah masuk ke git jauh lebih murah
  // daripada sesudah. `--exclude-standard` tetap menghormati .gitignore, jadi
  // .env, .wwebjs_auth, dan .tmp-*.mts tidak ikut terpindai.
  const keluaran = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: AKAR, encoding: 'utf8' },
  );
  return keluaran
    .split('\n')
    .filter((b) => b.trim() !== '')
    .filter((b) => !BERKAS_PEMERIKSA.test(b));
}

export function baca(berkas: string): string {
  return readFileSync(join(AKAR, berkas), 'utf8');
}

/**
 * Mengganti isi komentar dengan spasi, MEMPERTAHANKAN jumlah barisnya.
 *
 * Ini bukan kerapian melainkan syarat kebenaran untuk hampir semua pemeriksaan
 * di sini: berkas paling berbahaya di proyek ini justru yang komentarnya
 * MENJELASKAN jebakan yang sedang dijaga. `wa-client.ts` memuat contoh
 * `CONVERT_TZ` yang salah di dalam komentar supaya orang berikutnya tidak
 * mengulanginya; `db/wakhanza.ts` menulis "sequelize.sync() TIDAK PERNAH
 * dipanggil". Pemeriksa yang membaca komentar akan menuduh keduanya melanggar
 * aturan yang justru mereka ajarkan.
 *
 * Barisnya dipertahankan supaya nomor baris temuan tetap menunjuk ke tempat
 * yang benar saat dibuka di editor.
 */
export function buangKomentar(kode: string): string {
  let hasil = '';
  let i = 0;
  let kutip: string | null = null;

  while (i < kode.length) {
    const c = kode[i] as string;
    const d = kode[i + 1];

    if (kutip !== null) {
      hasil += c;
      // Kode 92 = garis miring terbalik. Ditulis sebagai KODE, bukan sebagai
      // karakter ber-escape, supaya berkas ini tetap terbaca sama persis lewat
      // alat apa pun yang menyalin atau menempelkannya.
      if (c.charCodeAt(0) === 92) {
        hasil += kode[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === kutip) kutip = null;
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      kutip = c;
      hasil += c;
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < kode.length && kode[i] !== '\n') {
        hasil += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && d === '*') {
      while (i < kode.length && !(kode[i] === '*' && kode[i + 1] === '/')) {
        hasil += kode[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      hasil += '  ';
      i += 2;
      continue;
    }

    hasil += c;
    i += 1;
  }

  return hasil;
}

/** Nomor baris (1-indeks) untuk sebuah offset karakter. */
export function barisDari(kode: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < kode.length; i++) if (kode[i] === '\n') n += 1;
  return n;
}
