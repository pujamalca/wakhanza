import { pemeriksaanAlamatWa, pemeriksaanNomor, pemeriksaanToken } from './checks/bocor';
import {
  pemeriksaanKursor,
  pemeriksaanOptOut,
  pemeriksaanSkema,
  pemeriksaanTulisKhanza,
  pemeriksaanZonaWaktu,
} from './checks/data';
import { pemeriksaanBatasRute, pemeriksaanPrimitif } from './checks/tampilan';
import type { Pemeriksaan } from './checks/tipe';

/**
 * `npm run preflight` -- pagar statis untuk aturan proyek ini yang pelanggarannya
 * TIDAK menghasilkan satu pun galat.
 *
 * ## Kenapa ia ada terpisah dari `npm test`
 *
 * Uji menjawab "apakah fungsi ini benar". Yang dijaga di sini bukan itu,
 * melainkan aturan LINTAS BERKAS yang tidak punya pemilik: nomor pasien yang
 * ikut ter-commit ke repo publik, pemicu baru yang lupa didaftarkan ke
 * keputusan opt-out, query ke Khanza yang berubah dari SELECT jadi UPDATE,
 * halaman yang menunggu database tanpa batas galat. Tidak satu pun dari itu
 * menggagalkan build, menggagalkan lint, atau memunculkan galat di layar
 * siapa pun -- persis kelas kegagalan yang paling mahal di proyek ini.
 *
 * ## Kenapa TANPA database
 *
 * Sama dengan alasan `jest.config.js` mengecualikan uji integrasi: begitu
 * sebuah pemeriksaan menuntut MariaDB hidup plus kredensial `.env`, ia berhenti
 * bisa dijalankan di pre-push dan berhenti dipakai. Yang menuntut database
 * hidup sudah punya tempatnya sendiri: `verify:db` dan `verify:plans`.
 *
 * Pemakaian:
 *   npm run preflight              -- semua pemeriksaan
 *   npm run preflight -- nomor     -- satu saja, saat memperbaiki temuan
 *   npm run preflight -- --daftar  -- lihat daftarnya tanpa menjalankan
 */
/**
 * Urutannya disengaja: kebocoran lebih dulu.
 *
 * Kalau seseorang menghentikan pembacaan di temuan pertama -- dan itu yang
 * benar-benar terjadi saat keluarannya panjang -- yang harus ia lihat lebih
 * dulu adalah yang TIDAK BISA DIBATALKAN sesudah ter-push. Nomor pasien yang
 * terlanjur publik tidak bisa ditarik oleh commit berikutnya; halaman tanpa
 * batas galat bisa diperbaiki kapan saja.
 */
const SEMUA: Pemeriksaan[] = [
  pemeriksaanNomor,
  pemeriksaanAlamatWa,
  pemeriksaanToken,
  pemeriksaanTulisKhanza,
  pemeriksaanSkema,
  pemeriksaanKursor,
  pemeriksaanZonaWaktu,
  pemeriksaanOptOut,
  pemeriksaanPrimitif,
  pemeriksaanBatasRute,
];

function main(): void {
  const argumen = process.argv.slice(2).filter((a) => a !== '');

  if (argumen.includes('--daftar')) {
    for (const p of SEMUA) console.log(`${p.nama.padEnd(16)} ${p.judul}`);
    return;
  }

  const diminta = argumen.filter((a) => !a.startsWith('--'));
  const dijalankan = diminta.length > 0 ? SEMUA.filter((p) => diminta.includes(p.nama)) : SEMUA;

  if (dijalankan.length === 0) {
    console.error(`Tidak ada pemeriksaan bernama: ${diminta.join(', ')}`);
    console.error(`Yang ada: ${SEMUA.map((p) => p.nama).join(', ')}`);
    process.exit(2);
  }

  let gagal = 0;

  for (const p of dijalankan) {
    const temuan = p.jalankan();

    if (temuan.length === 0) {
      console.log(`  OK   ${p.nama.padEnd(16)} ${p.judul}`);
      continue;
    }

    gagal += temuan.length;
    console.log('');
    console.log(`  GAGAL ${p.nama} -- ${p.judul}`);
    console.log(`        ${p.alasan}`);
    for (const t of temuan) {
      const tempat = t.baris === undefined ? t.berkas : `${t.berkas}:${t.baris}`;
      console.log(`        ${tempat}  ${t.pesan}`);
    }
    console.log('');
  }

  if (gagal > 0) {
    console.error(`preflight: ${gagal} temuan.`);
    process.exit(1);
  }

  console.log(`preflight: ${dijalankan.length} pemeriksaan lolos.`);
}

main();
