import { QueryTypes } from 'sequelize';
import { db } from '@/db/wakhanza';
import { WaSession } from '@/models';
import { AMBANG_BUNTU_MENIT, JENDELA_PANTAU_MENIT, type AckHealthInput } from '@/core/ackHealth';

/**
 * Bahan mentah untuk `ackHealth()` -- satu penurunan, dipakai BERSAMA oleh
 * worker (yang memperingatkan) dan dashboard (yang menampilkan).
 *
 * Tinggal di `lib/` justru karena kedua proses membutuhkannya: worker tidak
 * boleh mengimpor berkas dashboard, dan dua query yang masing-masing
 * menafsirkan sendiri "pesan mana yang seharusnya sudah berkabar" adalah dua
 * query yang cepat atau lambat menyimpang. Yang muncul saat menyimpang bukan
 * galat, melainkan **panel yang berkata tenang sementara webhook berteriak** --
 * atau sebaliknya, dan tidak ada cara memilih mana yang benar. Bentuk kegagalan
 * yang sudah berkali-kali dibayar di proyek ini (`respectsOptOut()`,
 * `core/outboxStatus.ts`, `kunciPesanMasuk()`, `core/tujuanPemicu.ts`,
 * `SCHEDULE_ACTOR`). Pola yang sama dengan `lib/mediaStorage.ts`, yang naik ke
 * sini begitu worker ikut menyimpan berkas.
 */

/** SUM(kondisi) di MariaDB mengembalikan DECIMAL, yang dibaca mysql2 sebagai string. */
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Nol DIBEDAKAN dari tidak ada, dan pembedaan itu wajib ditulis eksplisit:
 * `Number(null)` menjawab **0** dan lolos `Number.isFinite`, sehingga "tidak ada
 * satu pun pesan tersangkut" akan tampil sebagai "tersangkut paling lama 0
 * menit" -- kabar buruk yang dikarang dari kabar baik. Pelajaran yang sama
 * sudah dibayar `keAngka()` pada nota pengadaan (`migrations/028`), tempat
 * `h_beli` NULL tercetak sebagai "Rp0" alias gratis.
 */
function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface PantauAck extends AckHealthInput {
  /** Kapan sesi yang sedang berjalan terakhir mencapai `ready`. */
  siapSejak: Date | null;
  /** Umur pesan tersangkut yang PALING LAMA, untuk keterangan. null bila tak ada. */
  tersangkutTertuaMenit: number | null;
}

/**
 * ==========================================================================
 * SELURUH aritmetika waktu di sini dikerjakan SQL, dan itu bukan selera
 * ==========================================================================
 *
 * Objek `Date` yang diserahkan lewat `replacements` TIDAK sampai sebagai UTC.
 * Diukur langsung, bukan disimpulkan dari dokumentasi:
 *
 *   new Date('2026-08-15T01:03:40Z')  ->  SQL menerima '2026-08-15 08:03:40'
 *
 * Yaitu dikonversi ke waktu LOKAL (WIB) sementara kolom DATETIME di `wakhanza`
 * menyimpan UTC (Sequelize memakai `timezone: '+00:00'`). Jadi setiap
 * perbandingan `kolom >= :tanggal` meleset TEPAT TUJUH JAM, dan melesetnya ke
 * arah yang paling senyap: query tetap berhasil, tetap mengembalikan baris yang
 * masuk akal, cuma jendelanya bukan jendela yang diminta. Di detektor ini
 * akibatnya fatal dan sudah terbukti -- batas yang sama menghasilkan 1 baris
 * lewat literal SQL dan **0 baris** lewat `Date`, yaitu detektor yang diam
 * selamanya tanpa satu pun galat.
 *
 * Karena itu yang menyeberang ke SQL hanya BILANGAN BULAT (menit, jam), dan
 * setiap titik waktu dihitung dari `UTC_TIMESTAMP()` di sisi database. Arah
 * sebaliknya -- membaca DATETIME kembali ke JS -- aman dan tidak diubah: driver
 * menyerahkannya sebagai `Date` ber-UTC yang benar.
 *
 * Ini KERABAT dari jebakan yang sudah tercatat di CLAUDE.md ("baris yang
 * di-INSERT lewat SQL mentah tidak cocok dengan `Op.lte` Sequelize"), tapi
 * bukan jebakan yang sama: yang itu soal nilai yang DITULIS di luar Sequelize,
 * yang ini soal nilai yang DIBANDINGKAN dari dalamnya.
 */

/**
 * Batas bawah `created_at` yang ada MURNI untuk indeks, bukan untuk kebenaran.
 *
 * `outbox` tidak punya indeks pada `sent_at` (lihat `SHOW INDEX`: `ix_dispatch`,
 * `ix_rm`, `ix_campaign`, `ix_created`, `ix_wa_message`), jadi menyaring
 * `sent_at` sendirian berarti PEMINDAIAN PENUH atas tabel yang paling cepat
 * tumbuh di skema ini -- tiap lima menit, selamanya. Karena `created_at` selalu
 * mendahului `sent_at`, menambahkan batas bawah di atasnya aman dan membuat
 * `ix_created` terpakai: terukur `type=range, key=ix_created, rows=96`.
 *
 * 24 jam, bukan sepanjang jendela pantau: pesan bisa lahir pukul 22:00 lalu
 * ditahan jam tenang sampai 07:00 keesokan hari, jadi `created_at` bisa
 * mendahului `sent_at` sembilan jam. Dua puluh empat jam memberi lebih dari dua
 * kali lipat ambang basi terpanjang yang pernah disetel (12 jam).
 */
const SLACK_CREATED_JAM = 24;

/**
 * Membaca keadaan pengiriman TERKINI, bukan riwayat.
 *
 * Tiga penyaringnya masing-masing menutup satu sumber positif palsu, dan
 * ketiganya perlu -- lihat komentar di `AckHealthInput.jatuhTempo` untuk
 * angkanya.
 */
export async function bacaPantauAck(): Promise<PantauAck> {
  const sesi = await WaSession.findByPk(1);
  const sesiReady = sesi?.status === 'ready';

  /**
   * Batas bawah yang sebenarnya: pesan yang dikirim sesi SEBELUMNYA memang
   * tidak akan pernah berkabar, karena ack hanya tiba selama sesi yang
   * mengirimnya masih hidup. Terukur: 395 dari 783 kiriman ke grup dalam 14
   * hari tidak punya ack sama sekali, dan itu keadaan yang sepenuhnya sehat.
   *
   * `wa_session_event` insert-only, jadi baris `ready` terakhir adalah jawaban
   * yang tepat. Bila tidak ada sama sekali (pemasangan baru, atau riwayatnya
   * sudah dipangkas pada 90 hari), kita GAGAL TERBUKA: tanpa titik acuan,
   * setiap pesan lama tampak tersangkut, dan detektor yang berteriak pada
   * pemasangan baru adalah detektor yang dimatikan orang pada hari pertama.
   */
  /**
   * `string | Date` dan bukan salah satunya: mysql2 menyerahkan kolom DATETIME
   * sebagai `Date` (koneksi `wakhanza` TIDAK memakai `dateStrings`, berbeda dari
   * koneksi `sik`), sementara ekspresi agregat bisa turun sebagai string.
   * `new Date()` menerima keduanya, jadi yang penting tipenya jujur -- yang
   * tidak jujur mengundang `.split()` yang meledak hanya pada sebagian baris.
   */
  const [barisSiap] = await db.query<{ t: string | Date | null }>(
    `SELECT MAX(created_at) AS t FROM wa_session_event WHERE status_baru = 'ready'`,
    { type: QueryTypes.SELECT },
  );
  const siapSejak = barisSiap?.t ? new Date(barisSiap.t) : null;

  const kosong: PantauAck = { jatuhTempo: 0, berkabar: 0, sesiReady, siapSejak, tersangkutTertuaMenit: null };
  if (!sesiReady || !siapSejak) return kosong;

  /**
   * `GREATEST` mengambil yang paling belakangan di antara awal jendela dan saat
   * sesi siap: jendela menjaga penilaiannya tetap tentang SEKARANG, saat siap
   * menjaga agar pesan milik sesi sebelumnya tidak ikut dituduh.
   *
   * Subquery `wa_session_event` diulang di sini alih-alih memakai `siapSejak`
   * yang sudah dibaca di atas -- justru supaya tidak ada satu pun `Date` yang
   * menyeberang (lihat blok komentar besar di atas). Bila tabelnya tidak punya
   * baris `ready` sama sekali, subquery-nya NULL, `GREATEST` jadi NULL, dan
   * seluruh perbandingannya gugur menjadi nol baris -- gagal TERBUKA, persis
   * yang diinginkan.
   *
   * Umur pesan tersangkut juga dihitung di sisi database: menghitungnya di JS
   * berarti selisih jam antara server aplikasi dan MariaDB masuk ke angka yang
   * ditampilkan ke staf.
   */
  const [baris] = await db.query<{ jatuh_tempo: unknown; berkabar: unknown; tertua_menit: unknown }>(
    `SELECT COUNT(*) AS jatuh_tempo,
            SUM(ack_level IS NOT NULL) AS berkabar,
            TIMESTAMPDIFF(MINUTE, MIN(CASE WHEN ack_level IS NULL THEN sent_at END), UTC_TIMESTAMP())
              AS tertua_menit
       FROM outbox
      WHERE created_at >= UTC_TIMESTAMP() - INTERVAL :slackJam HOUR
        AND status = 'sent'
        AND wa_message_id IS NOT NULL
        AND sent_at >= GREATEST(
              UTC_TIMESTAMP() - INTERVAL :jendelaMenit MINUTE,
              (SELECT MAX(created_at) FROM wa_session_event WHERE status_baru = 'ready')
            )
        AND sent_at <= UTC_TIMESTAMP() - INTERVAL :ambangMenit MINUTE`,
    {
      replacements: {
        slackJam: SLACK_CREATED_JAM,
        jendelaMenit: JENDELA_PANTAU_MENIT,
        ambangMenit: AMBANG_BUNTU_MENIT,
      },
      type: QueryTypes.SELECT,
    },
  );

  return {
    jatuhTempo: toInt(baris?.jatuh_tempo),
    berkabar: toInt(baris?.berkabar),
    sesiReady,
    siapSejak,
    tersangkutTertuaMenit: toIntOrNull(baris?.tertua_menit),
  };
}
