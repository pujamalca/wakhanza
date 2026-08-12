/**
 * Pratinjau REKAP HARIAN RESEP (migrations/042) terhadap database Khanza MANA
 * PUN, berikut pemeriksaan pagar privasinya.
 *
 *   npm run dryrun:resep -- [nama-database] [tanggal]
 *
 * Tanpa argumen, ia memakai database produksi (`SIK_DB_NAME`) dan tanggal yang
 * BENAR-BENAR akan dibaca worker (dihitung dari `farmasi.resep_rekap_offset_hari`).
 *
 * Untuk menunjuk TANGGAL saja, nama databasenya tetap harus disebut:
 *
 *   npm run dryrun:resep -- alca 2026-08-10
 *
 * Bentuk `-- "" 2026-08-10` bekerja di bash tapi TIDAK di PowerShell, yang
 * membuang argumen string kosong sebelum Node melihatnya -- sehingga tanggalnya
 * bergeser jadi nama database dan gagal dengan `ER_DBACCESS_DENIED_ERROR` yang
 * menyesatkan ke arah izin, bukan ke arah argumen.
 *
 * ==========================================================================
 * Kenapa TANGGAL bisa diserahkan, dan kenapa itu bukan kenyamanan
 * ==========================================================================
 *
 * Rekap ini hanya pernah membaca SATU hari, dan di rumah sakit ini hari Minggu
 * NOL RESEP pada seluruh 90 hari terakhir. Tanpa cara menunjuk tanggal lain,
 * menjalankan skrip ini pada hari Minggu menghasilkan "tidak ada resep" -- yang
 * benar, dan sama sekali tidak membuktikan query-nya bekerja. Kelas kegagalan
 * yang sama sudah dibayar di `dryrun:kontrol`, yang juga menerima tanggal acuan.
 *
 * ==========================================================================
 * Yang WAJIB diperhatikan kalau berkas ini diubah
 * ==========================================================================
 *
 * Nama database di-override SESUDAH `lib/env` selesai memuat `.env` (yang
 * MENIMPA process.env), lalu modul yang membaca konfigurasi diimpor SECARA
 * DINAMIS. Mengubah impor di dalam main() menjadi `import` biasa di puncak
 * berkas membuat override-nya tidak berpengaruh sama sekali -- dan gejalanya
 * bukan galat, melainkan hasil yang diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim apa pun.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
const tanggalArg = process.argv[3];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { rekapResepHarian } = await import('../src/khanza/farmasiStaf');
  const { gabungRekapResep } = await import('../src/core/resepRekap');
  const { hariRekap } = await import('../src/core/rekapJadwal');
  const { susunVarsRekapResep, TRIGGER_RESEP_REKAP } = await import('../src/worker/resepRekapRunner');
  const { renderTemplate } = await import('../src/core/template');
  const { formatRupiah } = await import('../src/core/notaBarang');
  const { getSetting, getSettingBool, getSettingNumber } = await import('../src/models');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(`=== dryrun:resep terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`);

  try {
    const sekarang = new Date();
    const offset = await getSettingNumber('farmasi.resep_rekap_offset_hari', 0);
    const tanggalRekap = tanggalArg ?? hariRekap(sekarang, offset);

    const aktif = await getSettingBool('farmasi.resep_rekap_enabled', false);
    const jam = (await getSetting('farmasi.resep_rekap_jam', '22:00')) ?? '22:00';

    console.log(`  sakelar farmasi.resep_rekap_enabled : ${aktif ? 'MENYALA' : 'MATI'}`);
    console.log(`  jam kirim                           : ${jam}`);
    console.log(
      `  tanggal yang dibaca                 : ${tanggalRekap}` +
        (tanggalArg ? '  (diserahkan lewat argumen)' : `  (offset ${offset} hari dari hari ini)`),
    );

    const agregat = await rekapResepHarian(tanggalRekap);

    /**
     * PAGAR PRIVASI, diperiksa pada `Object.keys()` baris HASILNYA -- bukan
     * dengan membaca SQL.
     *
     * Ini pemeriksaan terpenting di skrip ini. `resep_obat` adalah tabel yang
     * seluruh proyek ini jaga sejak Fase 0, dan sebuah agregat memang tidak
     * menyebut siapa pun -- justru karena itu godaan melonggarkan daftar
     * SELECT-nya paling besar di sini. Yang menjaga tetap kolom yang tidak
     * pernah diambil (ARCHITECTURE §5.2).
     *
     * `no_rawat` ikut dilarang, dan itu BUKAN berlebihan: ia kunci menuju
     * `reg_periksa`, jadi kehadirannya berarti jalan menuju identitas pasien
     * sudah terbuka walau namanya belum ikut terbaca.
     *
     * Sejak migrations/043 pemeriksaan ini memikul lebih dari sebelumnya. Agregat
     * NILAI menjoinkan `detail_pemberian_obat` lewat `no_rawat` -- kunci join yang
     * sengaja tidak pernah masuk daftar SELECT. Di sinilah klaim itu dibuktikan:
     * pada `Object.keys()` baris yang benar-benar kembali, bukan dengan membaca
     * SQL-nya. `kode_brng` juga dijaga, karena tabel itu memuatnya per baris obat.
     */
    const TERLARANG = [
      'no_rkm_medis',
      'nm_pasien',
      'no_rawat',
      'kd_poli',
      'nm_poli',
      'kode_brng',
      'nama_brng',
      'aturan_pakai',
      'nama_racik',
    ];
    const kolom = [
      ...new Set([
        ...(agregat.header[0] ? Object.keys(agregat.header[0]) : []),
        ...(agregat.item[0] ? Object.keys(agregat.item[0]) : []),
        ...(agregat.racikan[0] ? Object.keys(agregat.racikan[0]) : []),
        ...(agregat.nilai[0] ? Object.keys(agregat.nilai[0]) : []),
      ]),
    ];
    const bocor = kolom.filter((k) => TERLARANG.includes(k));
    console.log(`\n  kolom yang benar-benar terbaca: ${kolom.length > 0 ? kolom.join(', ') : '(tidak ada baris)'}`);
    console.log(
      bocor.length === 0
        ? '  [ok] PAGAR PRIVASI -- tidak satu pun kolom pasien, obat, atau dosis terbaca'
        : `  [BOCOR] kolom terlarang terbaca: ${bocor.join(', ')} -- lihat komentar pembuka khanza/farmasiStaf.ts`,
    );
    if (bocor.length > 0) process.exitCode = 1;

    const ringkas = gabungRekapResep(agregat.header, agregat.item, agregat.racikan, agregat.nilai);
    console.log(
      `\n  ${ringkas.jmlResep} resep, ${ringkas.jmlBaris} baris obat (${ringkas.jmlObat} satuan), ` +
        `${ringkas.jmlRacikan} racikan; ${ringkas.jmlSerah} diserahkan, ${ringkas.jmlBelumSerah} belum; ` +
        `${ringkas.perDokter.length} dokter; nilai ${formatRupiah(ringkas.nilaiObat)}`,
    );

    /**
     * Janji KEDUA yang dibaca orang dari pesannya: `{nilai_obat}` di kepala harus
     * sama dengan jumlah kolom rupiah pada `{rincian_dokter}` di bawahnya. Dijamin
     * aritmetika karena totalnya dijumlahkan dari baris per dokter -- ini yang
     * berbunyi kalau suatu saat ia diganti query total tersendiri.
     */
    const totalDokter = ringkas.perDokter.reduce((t, d) => t + d.nilaiObat, 0);
    const cocok = totalDokter === ringkas.nilaiObat;
    console.log(
      cocok
        ? '  [ok] total rupiah = jumlah rupiah seluruh dokter'
        : `  [SALAH] total ${ringkas.nilaiObat} != jumlah per dokter ${totalDokter}`,
    );
    if (!cocok) process.exitCode = 1;

    /**
     * Janji yang dibaca orang dari pesannya, diperiksa di sini juga: ia
     * menjumlahkan dua angka di layar dan mengharapkan angka ketiga. Kalau
     * suatu saat `jmlBelumSerah` berhenti diturunkan, ini yang berbunyi.
     */
    const genap = ringkas.jmlSerah + ringkas.jmlBelumSerah === ringkas.jmlResep;
    console.log(
      genap
        ? '  [ok] diserahkan + belum = jumlah resep'
        : `  [SALAH] ${ringkas.jmlSerah} + ${ringkas.jmlBelumSerah} != ${ringkas.jmlResep}`,
    );
    if (!genap) process.exitCode = 1;

    const identitas = await getHospitalIdentity();
    const idVars = identityVars(identitas);
    const kodeTemplate = await loadUniqueCodeTemplate();

    const body = (await getSetting('farmasi.template_resep_rekap', '')) ?? '';
    const bodyKosong = (await getSetting('farmasi.template_resep_rekap_kosong', '')) ?? '';
    const dipakai = ringkas.kosong ? (bodyKosong.trim() ? bodyKosong : null) : body;

    if (dipakai === null) {
      console.log(
        '\n  Hari itu tidak ada resep, dan "pesan saat kosong" dibiarkan kosong -- jadi sistem sengaja DIAM.',
      );
      console.log(
        '  Kalau tanggal itu hari Minggu, itu keadaan yang wajar di sini: terukur nol resep pada seluruh 13 hari Minggu terakhir.',
      );
      console.log('  Untuk melihat bentuk pesannya, jalankan ulang dengan tanggal lain:');
      console.log('    npm run dryrun:resep -- "" 2026-08-10');
    } else if (!dipakai.trim()) {
      console.log('\n  (isi pesan rekap masih kosong -- isi di /farmasi?tab=resep)');
    } else {
      const teks = appendUniqueCode(
        renderTemplate(dipakai, { ...idVars, ...susunVarsRekapResep(ringkas, tanggalRekap, sekarang) }),
        buildIdempotencyKey(TRIGGER_RESEP_REKAP, tanggalRekap, 'contoh@g.us'),
        kodeTemplate,
        sekarang,
      );
      console.log(`\n${teks}\n`);
    }
  } finally {
    await sik.close();
    await db.close();
  }
}

void main();
