import { QueryTypes } from 'sequelize';
import { db } from '../src/db/wakhanza';

/**
 * Empat dari enam pemeriksaan sebelum worker dimulai ulang, yang bagian
 * DATABASE-nya. Sisanya (uptime PM2, ukuran Chromium) hidup di
 * `scripts/restart-worker.ps1`, yang memanggil skrip ini lebih dulu.
 *
 * ## Kenapa ini ada sebagai skrip, bukan sebagai daftar di dokumen
 *
 * Prosedurnya sudah tertulis lengkap di CLAUDE.md dan sudah ditempuh berkali-
 * kali. Yang tetap terjadi: pada 16 Agustus 2026 sesinya diperiksa dan
 * seluruhnya sehat -- status ready, denyut 14 detik, nol percakapan berjalan,
 * antrean kosong -- lalu di-restart, dan penautannya tersangkut. Yang TIDAK
 * diperiksa adalah `uptime`: tiga belas menit, artinya itu restart KEDUA.
 *
 * Daftar periksa yang dijalankan manusia akan melewatkan satu butir cepat atau
 * lambat, dan di mesin ini butir yang terlewat berujung pada pemindaian QR yang
 * menuntut akses fisik ke ponsel nomor RS. Itu sebabnya ia jadi skrip.
 *
 * Skrip ini TIDAK me-restart apa pun. Ia menjawab satu pertanyaan: aman atau
 * tidak. Keluar 0 = aman, 1 = ada yang menahan, 2 = tidak bisa memeriksa.
 */

interface Butir {
  nama: string;
  nilai: string;
  aman: boolean;
  /** Dicetak hanya saat butirnya menahan. */
  sebab: string;
}

/**
 * Umur denyut dibaca MENTAH, tanpa CONVERT_TZ, dan itu bukan kelalaian.
 * Sequelize menyetel `@@session.time_zone` sesinya sendiri ke `+00:00`, jadi
 * `heartbeat_at` (UTC) dan `NOW()` sudah sezona. Menerapkan CONVERT_TZ di jalur
 * ini menggeser hasilnya tepat 25.200 detik ke arah yang salah -- denyut tiga
 * detik terbaca sebagai minus tujuh jam. Lewat CLI `mysql` aturannya kebalikan.
 */
const SQL_SESI = `
  SELECT status,
         TIMESTAMPDIFF(SECOND, heartbeat_at, NOW()) AS umur_denyut,
         hapus_sesi_saat_mulai,
         last_error
    FROM wa_session
   LIMIT 1
`;

async function main(): Promise<void> {
  const butir: Butir[] = [];

  const sesi = await db.query<{
    status: string | null;
    umur_denyut: number | null;
    hapus_sesi_saat_mulai: number | null;
    last_error: string | null;
  }>(SQL_SESI, { type: QueryTypes.SELECT });

  const baris = sesi[0];
  if (baris === undefined) {
    console.error('wa_session kosong -- worker belum pernah jalan. Tidak ada yang perlu ditahan.');
    process.exit(2);
  }

  butir.push({
    nama: 'status sesi',
    nilai: String(baris.status ?? '(kosong)'),
    aman: baris.status === 'ready',
    sebab:
      'Sesi yang belum ready berarti restart menimpa penautan yang sedang berjalan. ' +
      'Kalau statusnya qr_pending, ada orang yang sedang memindai -- restart menerbitkan ' +
      'QR baru dan membatalkan kode yang ada di tangannya.',
  });

  const umur = baris.umur_denyut;
  butir.push({
    nama: 'umur denyut',
    nilai: umur === null ? '(kosong)' : `${umur} detik`,
    aman: umur !== null && umur >= 0 && umur < 40,
    sebab:
      'Denyut basi berarti tidak ada proses worker yang hidup -- yang perlu diperiksa ' +
      'bukan sesinya melainkan prosesnya. Denyut NEGATIF berarti pembacaannya kena ' +
      'jebakan zona waktu, bukan berarti worker berdenyut di masa depan.',
  });

  butir.push({
    nama: 'bendera hapus sesi',
    nilai: String(baris.hapus_sesi_saat_mulai ?? 0),
    aman: (baris.hapus_sesi_saat_mulai ?? 0) === 0,
    sebab:
      'Bendera ini menyuruh worker MENGOSONGKAN .wwebjs_auth saat mulai. Restart dengan ' +
      'bendera menyala menuntut pemindaian QR, dan itu menuntut ponsel nomor RS.',
  });

  const antre = await db.query<{ jumlah: number }>(
    "SELECT COUNT(*) AS jumlah FROM outbox WHERE status IN ('pending','sending')",
    { type: QueryTypes.SELECT },
  );
  const jumlahAntre = Number(antre[0]?.jumlah ?? 0);
  butir.push({
    nama: 'antrean aktif',
    nilai: String(jumlahAntre),
    aman: jumlahAntre === 0,
    sebab:
      'Baris berstatus sending saat proses mati tidak pernah pulih sendiri: ia ditandai ' +
      'failed_permanent oleh recoverInterruptedSends() karena hasilnya tidak bisa diketahui. ' +
      'Tunggu antreannya kosong, atau terima bahwa yang sedang dikirim perlu ditinjau manual.',
  });

  butir.push({
    nama: 'galat terakhir',
    nilai: baris.last_error === null ? '(nihil)' : baris.last_error.slice(0, 60),
    aman: true, // keterangan, bukan penahan
    sebab: '',
  });

  let tertahan = 0;
  for (const b of butir) {
    const tanda = b.sebab === '' ? '  --' : b.aman ? '  OK' : 'TAHAN';
    console.log(`  ${tanda}  ${b.nama.padEnd(18)} ${b.nilai}`);
    if (!b.aman) tertahan += 1;
  }

  if (tertahan > 0) {
    console.log('');
    for (const b of butir) {
      if (b.aman || b.sebab === '') continue;
      console.log(`  ${b.nama}: ${b.sebab}`);
    }
    console.log('');
    console.error(`pra-restart: ${tertahan} butir menahan restart.`);
    await db.close();
    process.exit(1);
  }

  console.log('pra-restart: bagian database aman.');
  await db.close();
}

main().catch(async (galat: unknown) => {
  console.error('pra-restart gagal memeriksa:', galat instanceof Error ? galat.message : galat);
  try {
    await db.close();
  } catch {
    /* kolam mungkin belum terbuka */
  }
  process.exit(2);
});
