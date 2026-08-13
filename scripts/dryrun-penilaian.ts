/**
 * Pratinjau REKAP ASESMEN AWAL KEPERAWATAN (migrations/044) terhadap database
 * Khanza MANA PUN, berikut pemeriksaan pagar privasinya.
 *
 *   npm run dryrun:penilaian -- [nama-database] [tanggal]
 *
 * Tanpa argumen: database produksi (`SIK_DB_NAME`) dan tanggal yang BENAR-BENAR
 * akan dibaca worker (dihitung dari `erm.penilaian_offset_hari`).
 *
 * Untuk menunjuk TANGGAL saja, nama databasenya tetap harus disebut:
 *
 *   npm run dryrun:penilaian -- alca 2026-08-12
 *
 * Bentuk `-- "" 2026-08-12` bekerja di bash tapi TIDAK di PowerShell, yang
 * membuang argumen string kosong sebelum Node melihatnya -- sehingga tanggalnya
 * bergeser jadi nama database dan gagal dengan `ER_DBACCESS_DENIED_ERROR` yang
 * menyesatkan ke arah izin. Pelajaran `dryrun:resep`.
 *
 * ==========================================================================
 * Kenapa TANGGAL bisa diserahkan
 * ==========================================================================
 *
 * Rekap ini hanya pernah membaca SATU hari, dan hari Minggu praktis nol pasien
 * baru di sini. Menjalankannya pada hari Minggu menghasilkan "tidak ada pasien"
 * -- benar, dan sama sekali tidak membuktikan query-nya bekerja. Kelas kegagalan
 * yang sama sudah dibayar di `dryrun:kontrol` dan `dryrun:resep`.
 *
 * ==========================================================================
 * Pagar privasi diperiksa pada OBJEK BARISNYA, bukan dengan membaca SQL
 * ==========================================================================
 *
 * Tabel asesmen memuat rekam medis telanjang (keluhan utama, riwayat penyakit,
 * alergi, skala nyeri, kondisi psikologis). Yang membuktikan kolomnya tidak
 * sampai ke proses ini bukan pembacaan daftar SELECT melainkan `Object.keys()`
 * atas baris yang benar-benar kembali. Skrip ini KELUAR DENGAN KODE 1 bila
 * salah satunya bocor -- kalau tidak, ia cuma mencetak peringatan yang mudah
 * terlewat di tengah keluaran lain.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim apa pun.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
const tanggalArg = process.argv[3];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

/**
 * Kolom yang TIDAK BOLEH ada di baris hasil.
 *
 * Bukan daftar lengkap isi tabelnya -- ini yang paling telanjang, dan yang
 * paling mungkin ditambahkan orang berikutnya "karena berguna".
 */
const TERLARANG = [
  'keluhan_utama',
  'rpd',
  'rpk',
  'rpo',
  'alergi',
  'status_psiko',
  'ket_psiko',
  'nyeri',
  'skala_nyeri',
  'lokasi',
  'ekonomi',
  'hub_keluarga',
  'tinggal_dengan',
  'adl',
  'total_hasil',
  'hasil',
];

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { daftarPenilaianAwal, rekapPenilaianAwal, normalkanKolomInti } = await import(
    '../src/khanza/penilaianAwal'
  );
  const { susunRekapPenilaian } = await import('../src/worker/penilaianRunner');
  const { renderTemplate } = await import('../src/core/template');
  /**
   * `identityVars()` WAJIB ikut, dan ketiadaannya bukan hal kecil.
   *
   * `enqueueMessage()` menyisipkannya sendiri sebagai DASAR untuk setiap pesan,
   * jadi produksi selalu mengisi `{nama_rs}`/`{kontak_rs}`. Pratinjau tanpa itu
   * merender baris kosong di tempat nama rumah sakit -- dan staf yang melihatnya
   * wajar menyimpulkan templatenya rusak lalu membuang variabel yang sebenarnya
   * sudah benar. Pelajaran `worker/triggerVars.ts`.
   */
  const { identityVars } = await import('../src/worker/pipeline');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { getSetting, getSettingNumber, getSettingBool } = await import('../src/models');
  const { hariRekap, bacaSlotRekap, tulisJamRekap, slotJatuhTempo } = await import(
    '../src/core/rekapJadwal'
  );

  console.log(`database Khanza : ${sikDbConfig().database}`);

  const sekarang = new Date();
  const offset = await getSettingNumber('erm.penilaian_offset_hari', 0);
  const tanggal = tanggalArg ?? hariRekap(sekarang, offset);
  console.log(`tanggal direkap : ${tanggal}${tanggalArg ? ' (diserahkan lewat argumen)' : ''}`);

  const [ermAktif, penilaianAktif, jamRaw, poli, kolomRaw, penanda] = await Promise.all([
    getSettingBool('erm.enabled', false),
    getSettingBool('erm.penilaian_enabled', false),
    getSetting('erm.penilaian_jam', '13:00,19:30'),
    getSetting('erm.penilaian_poli', ''),
    getSetting('erm.penilaian_kolom_inti', 'td,nadi,suhu,rr'),
    getSetting('erm.penilaian_last_run', ''),
  ]);

  const slots = bacaSlotRekap(jamRaw);
  const kolomInti = normalkanKolomInti(
    (kolomRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  console.log(`sakelar         : erm.enabled=${ermAktif ? 'NYALA' : 'mati'}, penilaian_enabled=${penilaianAktif ? 'NYALA' : 'mati'}`);
  console.log(`jam kirim       : ${slots.map(tulisJamRekap).join(', ') || '(tidak ada yang terbaca)'}`);
  console.log(`kolom inti      : ${kolomInti.join(', ')}`);
  console.log(`batasi poli     : ${poli || '(seluruh poli)'}`);
  console.log(`penanda terakhir: ${penanda || '(belum pernah)'}`);

  const slotSekarang = slotJatuhTempo(sekarang, slots, penanda);
  console.log(
    `jatuh tempo kini: ${slotSekarang ? tulisJamRekap(slotSekarang) : '(tidak ada slot yang jatuh tempo sekarang)'}`,
  );

  // ---------------------------------------------------------------------
  // 1. Pagar privasi -- diperiksa pada objek barisnya
  // ---------------------------------------------------------------------
  console.log('\n=== PAGAR PRIVASI ===');
  const contoh = await daftarPenilaianAwal({ dari: tanggal, sampai: tanggal, kolomInti });
  if (contoh.length === 0) {
    console.log('(tidak ada baris pada tanggal ini, pagar tidak bisa diperiksa dari data)');
  } else {
    const kunci = Object.keys(contoh[0] as unknown as Record<string, unknown>);
    console.log(`kolom yang benar-benar terbaca: ${kunci.join(', ')}`);
    const bocor = TERLARANG.filter((k) => kunci.includes(k));
    if (bocor.length > 0) {
      console.error(`\n[BOCOR] kolom rekam medis ikut terbaca: ${bocor.join(', ')}`);
      await sik.close();
      await db.close();
      process.exit(1);
    }
    console.log('[ok] tidak satu pun kolom rekam medis ikut terbaca');
  }

  // ---------------------------------------------------------------------
  // 2. Ringkasan hari itu
  // ---------------------------------------------------------------------
  const ringkas = await rekapPenilaianAwal(tanggal, { kolomInti });
  console.log('\n=== RINGKASAN ===');
  console.log(`pasien baru      : ${ringkas.total}`);
  console.log(`  lengkap        : ${ringkas.lengkap}`);
  console.log(`  belum diisi    : ${ringkas.belum}`);
  console.log(`  terisi sebagian: ${ringkas.sebagian}`);
  console.log(`perlu ditindak   : ${ringkas.perluDiisi.length}`);

  // ---------------------------------------------------------------------
  // 3. Pesan yang AKAN dikirim
  // ---------------------------------------------------------------------
  console.log('\n=== PESAN YANG AKAN DIKIRIM ===');
  const hasil = await susunRekapPenilaian(tanggal, sekarang);
  if (hasil.body === null) {
    console.log(
      '(tidak ada pesan)\n' +
        'Seluruh asesmen sudah lengkap, dan `erm.template_penilaian_kosong` dikosongkan --\n' +
        'jadi worker sengaja diam. Itu perilaku yang dirancang, bukan kegagalan.',
    );
  } else {
    const identitas = identityVars(await getHospitalIdentity());
    const render = (vars: Record<string, string>) =>
      renderTemplate(hasil.body!, { ...identitas, ...vars });
    hasil.bagian.forEach((vars, i) => {
      if (hasil.bagian.length > 1) console.log(`\n--- bagian ${i + 1} dari ${hasil.bagian.length} ---`);
      console.log(render(vars));
    });
    console.log(`\n(panjang: ${hasil.bagian.map((v) => render(v).length).join(' + ')} karakter)`);
  }

  console.log(
    '\nCATATAN: angka di atas dihitung TANPA memperhatikan sakelar maupun jam.\n' +
      'Worker hanya mengirim bila kedua sakelar menyala, ada slot jatuh tempo, dan\n' +
      'ada tujuan yang mencentang "Terima rekap".',
  );

  await sik.close();
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
