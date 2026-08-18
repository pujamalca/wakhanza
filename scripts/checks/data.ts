import { baca, barisDari, berkasTerlacak, buangKomentar, AKAR, type Pemeriksaan, type Temuan } from './tipe';
import { kodePemicuDariMigrasi } from './migrasiTemplate';

/* ------------------------------------------------------------------------- *
 * 1. Khanza dibaca, tidak pernah ditulis
 * ------------------------------------------------------------------------- */

/**
 * Sasaran desain nomor satu proyek ini (PRD §3): nol perubahan pada SIMRS
 * Khanza. Ia sudah ditegakkan MESIN lewat grant MariaDB, dan `npm run verify:db`
 * membuktikannya -- tapi verify:db menuntut MariaDB hidup plus kredensial,
 * sehingga ia TIDAK bisa jalan di pre-push dan pada praktiknya dijalankan hanya
 * saat seseorang ingat.
 *
 * Pemeriksaan ini menangkap kelas yang sama satu langkah lebih awal dan tanpa
 * database: kata kerja penulisan di dalam SQL yang ditujukan ke Khanza. Ia
 * TIDAK menggantikan verify:db (grant tetap satu-satunya penegakan sungguhan);
 * ia membuat kesalahannya terlihat sebelum kodenya sempat dijalankan.
 */
/**
 * `UPDATE` sengaja menuntut nama tabel sesudahnya (`UPDATE\s+[A-Za-z_]\w*`),
 * bukan kata `UPDATE` telanjang: tanpa itu ia ikut menuduh `ON DUPLICATE KEY
 * UPDATE` dan `FOR UPDATE` -- keduanya sah dan keduanya dipakai di sini.
 *
 * Versi pertama menulis `UPDATE\s+\w` dengan `\b` di ujung alternasinya, dan
 * itu TIDAK PERNAH cocok: `\b` sesudah satu huruf menuntut batas kata tepat di
 * situ, sementara nama tabel sungguhan berlanjut. Pemeriksaannya hijau selama
 * satu jam tanpa pernah bisa merah. Ketahuan hanya karena ia diuji-gigit.
 */
const KATA_TULIS =
  /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_]\w*|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+(?:TABLE|INDEX))/gi;

export const pemeriksaanTulisKhanza: Pemeriksaan = {
  nama: 'tulis-khanza',
  judul: 'Query ke Khanza hanya SELECT',
  alasan:
    'Nol perubahan pada SIMRS Khanza adalah sasaran desain nomor satu (PRD §3). ' +
    'Kalau sebuah kata kerja penulisan benar-benar diperlukan, ia BUKAN milik src/khanza -- ' +
    'dan grant wakhanza_ro akan menolaknya saat dijalankan.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!berkas.startsWith('src/khanza/')) continue;
      if (berkas.endsWith('.test.ts')) continue;

      const kode = buangKomentar(baca(berkas));
      for (const cocok of kode.matchAll(KATA_TULIS)) {
        temuan.push({
          berkas,
          baris: barisDari(kode, cocok.index ?? 0),
          pesan: `kata kerja penulisan dalam query Khanza: ${cocok[0].toUpperCase()}`,
        });
      }
    }

    return temuan;
  },
};

/* ------------------------------------------------------------------------- *
 * 2. Skema hanya lewat migrasi
 * ------------------------------------------------------------------------- */

export const pemeriksaanSkema: Pemeriksaan = {
  nama: 'skema',
  judul: 'Skema wakhanza hanya lahir dari migrations/*.sql',
  alasan:
    'sequelize.sync() menyelaraskan skema dari definisi model dan bisa MENGUBAH tabel ' +
    'produksi tanpa satu pun migrasi tercatat -- termasuk audit_log yang sengaja ' +
    'append-only. Skema berubah lewat migrations/NNN_*.sql, dijalankan npm run migrate.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!/^(?:src|scripts)\/.*\.tsx?$/.test(berkas)) continue;
      if (berkas.startsWith('scripts/migrate')) continue;

      const kode = buangKomentar(baca(berkas));
      for (const cocok of kode.matchAll(/\.sync\s*\(/g)) {
        temuan.push({
          berkas,
          baris: barisDari(kode, cocok.index ?? 0),
          pesan: 'panggilan .sync() -- skema tidak boleh lahir dari model',
        });
      }
    }

    return temuan;
  },
};

/* ------------------------------------------------------------------------- *
 * 3. CONVERT_TZ tidak pernah di jalur Sequelize
 * ------------------------------------------------------------------------- */

/**
 * Jebakan yang sudah menelan satu diagnosis utuh: Sequelize menyetel zona
 * SESINYA sendiri ke `+00:00`, jadi di jalur itu `NOW()` ikut UTC dan kedua
 * sisinya SUDAH sezona. Menerapkan `CONVERT_TZ` di sana menghasilkan galat
 * tujuh jam dengan tanda terbalik -- denyut 3 detik terbaca -25.197, yaitu
 * worker yang seolah berdenyut tujuh jam di masa depan.
 *
 * `CONVERT_TZ` benar dan perlu di jalur CLI `mysql`, tempat `@@session.time_zone`
 * bernilai SYSTEM. Karena itu yang dijaga hanya `src/**`.
 */
export const pemeriksaanZonaWaktu: Pemeriksaan = {
  nama: 'zona-waktu',
  judul: 'CONVERT_TZ tidak dipakai di jalur Sequelize',
  alasan:
    'Sequelize menyetel @@session.time_zone ke +00:00, jadi kolom dan NOW() sudah sezona. ' +
    'CONVERT_TZ di sana menggeser hasilnya 7 jam ke arah yang salah. Ia benar HANYA lewat ' +
    'CLI mysql. Kalau memang butuh jam dinding WIB untuk pengelompokan tanggal, tulis ' +
    'alasannya di komentar tepat di atasnya -- komentar diabaikan pemeriksaan ini.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!/^src\/.*\.tsx?$/.test(berkas)) continue;

      const kode = buangKomentar(baca(berkas));
      for (const cocok of kode.matchAll(/CONVERT_TZ/g)) {
        temuan.push({
          berkas,
          baris: barisDari(kode, cocok.index ?? 0),
          pesan: 'CONVERT_TZ di kode yang berjalan lewat Sequelize',
        });
      }
    }

    return temuan;
  },
};

/* ------------------------------------------------------------------------- *
 * 4. Watermark hanya dimajukan lewat satu pintu
 * ------------------------------------------------------------------------- */

/**
 * `advanceCursor()` di `worker/cursor.ts` adalah SATU-SATUNYA tempat
 * `poll_cursor.cursor_ts` maju, dan di situlah pagar "kursor tidak boleh
 * melampaui waktu berjalan" dipasang. Pagar itu ada karena satu pendaftaran
 * ber-`jam_reg` 19:59 yang diketik pukul 06:15 pernah melempar kursornya ke
 * masa depan dan membuat TIGA BELAS pasien tidak menerima nomor antriannya --
 * tanpa galat, tanpa baris outbox, dengan log yang melaporkan "rowsSeen 0".
 *
 * Poller berikutnya ditulis orang yang tidak pernah mendengar itu. Yang
 * memanggil model `PollCursor` langsung melewati pagarnya, dan yang lupa tidak
 * mendapat satu pun galat.
 */
export const pemeriksaanKursor: Pemeriksaan = {
  nama: 'kursor',
  judul: 'poll_cursor hanya dimajukan lewat worker/cursor.ts',
  alasan:
    'Pagar "kursor tidak boleh melampaui waktu berjalan" hidup di advanceCursor(). ' +
    'Menulis PollCursor langsung melewatinya, dan akibatnya adalah baris yang dilewati ' +
    'diam-diam: tidak ada galat, tidak ada outbox, log melaporkan rowsSeen 0.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!/^src\/.*\.tsx?$/.test(berkas)) continue;
      if (berkas === 'src/worker/cursor.ts') continue;
      if (berkas.startsWith('src/models/')) continue;
      if (berkas.endsWith('.test.ts')) continue;

      const kode = buangKomentar(baca(berkas));
      for (const cocok of kode.matchAll(/PollCursor\.(update|upsert|create|destroy)\s*\(/g)) {
        temuan.push({
          berkas,
          baris: barisDari(kode, cocok.index ?? 0),
          pesan: `PollCursor.${cocok[1]}() di luar worker/cursor.ts -- pakai advanceCursor()`,
        });
      }
    }

    return temuan;
  },
};

/* ------------------------------------------------------------------------- *
 * 5. Tiap pemicu punya keputusan opt-out yang SADAR
 * ------------------------------------------------------------------------- */

/**
 * `respectsOptOut()` memperlakukan kode pemicu yang tidak terdaftar sebagai
 * TIDAK terikat -- keputusan yang benar (kanal baru tidak boleh diam-diam
 * berhenti terkirim), tapi ia berarti pemicu pasien BARU yang lupa didaftarkan
 * akan mengirim ke orang yang sudah meminta berhenti, tanpa satu pun galat.
 *
 * Pemeriksaan ini menuntut tiap baris `template` yang benar-benar ada punya
 * keputusan yang TERTULIS: terikat (OPT_OUT_TRIGGERS) atau sengaja bebas
 * (PEMICU_SENGAJA_BEBAS). Bentuknya sama dengan `outboxStatus.test.ts` yang
 * menuntut kedua golongan MEMBAGI HABIS enum-nya: yang baru memaksa
 * keputusannya diambil sadar-sadar alih-alih diam di celah.
 */
function daftarDari(kode: string, nama: string): Set<string> {
  const mulai = kode.indexOf(`${nama} = new Set([`);
  if (mulai === -1) return new Set();
  const akhir = kode.indexOf(']);', mulai);
  const isi = kode.slice(mulai, akhir === -1 ? undefined : akhir);
  return new Set([...isi.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] as string));
}

export const pemeriksaanOptOut: Pemeriksaan = {
  nama: 'opt-out',
  judul: 'Tiap pemicu punya keputusan opt-out yang tertulis',
  alasan:
    'Kode pemicu yang tidak terdaftar dianggap TIDAK terikat opt-out, tanpa galat. ' +
    'Pemicu pasien yang lupa didaftarkan karena itu mengirim ke orang yang sudah meminta ' +
    'berhenti. Daftarkan di OPT_OUT_TRIGGERS (terikat) atau PEMICU_SENGAJA_BEBAS (tidak), ' +
    'keduanya di src/core/optOut.ts, berikut alasannya.',
  jalankan(): Temuan[] {
    const kode = buangKomentar(baca('src/core/optOut.ts'));
    const terikat = daftarDari(kode, 'OPT_OUT_TRIGGERS');
    const bebas = daftarDari(kode, 'PEMICU_SENGAJA_BEBAS');
    const temuan: Temuan[] = [];

    if (terikat.size === 0) {
      return [{ berkas: 'src/core/optOut.ts', pesan: 'OPT_OUT_TRIGGERS tidak terbaca -- parsernya rusak' }];
    }

    for (const pemicu of new Set(kodePemicuDariMigrasi(AKAR))) {
      if (terikat.has(pemicu) || bebas.has(pemicu)) continue;
      temuan.push({
        berkas: 'src/core/optOut.ts',
        pesan: `pemicu "${pemicu}" ada di migrations tapi tidak punya keputusan opt-out`,
      });
    }

    for (const pemicu of bebas) {
      if (!terikat.has(pemicu)) continue;
      temuan.push({
        berkas: 'src/core/optOut.ts',
        pesan: `pemicu "${pemicu}" tercatat DUA KALI: terikat sekaligus sengaja bebas`,
      });
    }

    return temuan;
  },
};
