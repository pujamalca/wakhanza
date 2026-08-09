import { pollResultReady, type ResultReadyRow, type PenunjangJenis } from '@/khanza/penunjang';
import { buildIdempotencyKey } from '@/core/idempotency';
import { getSettingNumber } from '@/models';
import { dokumenAktif, bacaPesanDokumen, KUOTA_BAWAAN, SETTING_KUOTA } from '@/lib/dokumen';
import { runSisipCycle } from './sisipCycle';
import { siapkanLampiranDokumen } from './dokumenLampiran';
import { varsResultReady } from './triggerVars';

/**
 * Kode pemicu per jenis (migrations/034), bukan satu kode bersama seperti
 * sebelumnya. Sejak `template_target` (018) tujuan tambahan dipasang per
 * `trigger_code`, jadi satu kode bersama berarti grup Laboratorium dan grup
 * Radiologi tidak bisa dipisahkan -- keduanya menerima setiap hasil, termasuk
 * yang bukan pekerjaannya. Bentuk yang sama persis dengan
 * LAB_REQUEST/RAD_REQUEST di `pollerPermintaan.ts`.
 */
const TRIGGER_BY_JENIS: Record<PenunjangJenis, string> = {
  lab: 'LAB_RESULT',
  radiologi: 'RAD_RESULT',
};

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/**
 * Lampiran PDF hasil pemeriksaan (migrations/038), atau `undefined` bila jenis
 * ini belum dinyalakan rumah sakit.
 *
 * Pengaturannya dibaca SEKALI per siklus, bukan per baris: nilainya tidak
 * berubah di tengah siklus, dan membacanya ulang per pasien berarti dua query
 * tambahan untuk jawaban yang sama. Dibaca di sini alih-alih di dalam
 * `siapkanLampiranDokumen()` justru supaya sakelar yang MATI tidak menyentuh
 * apa pun -- tanpa `lampiran`, `runSisipCycle` bahkan tidak menghitung kunci
 * mana yang baru.
 */
async function opsiLampiran(jenis: PenunjangJenis) {
  const jenisDokumen = jenis === 'lab' ? 'lab' : 'radiologi';
  if (!(await dokumenAktif(jenisDokumen))) return undefined;

  const [pesan, kuota] = await Promise.all([
    bacaPesanDokumen(jenisDokumen),
    getSettingNumber(SETTING_KUOTA, KUOTA_BAWAAN),
  ]);

  return {
    kuota,
    buat: (row: ResultReadyRow) =>
      siapkanLampiranDokumen(
        { jenis: jenisDokumen, noRawat: row.no_rawat, tglPeriksa: row.tgl_periksa },
        pesan,
        // Seed kode unik HARUS sama dengan kunci idempoten barisnya -- kode di
        // pesan yang benar-benar terkirim diturunkan dari sana, dan pemeriksaan
        // panjang keterangan di sini menghitung baris kode yang sama.
        buildIdempotencyKey('RESULT_READY', row.no_rawat, jenis, row.tgl_periksa),
      ),
  };
}

async function runOne(jenis: PenunjangJenis): Promise<void> {
  await runSisipCycle<ResultReadyRow>({
    lampiran: await opsiLampiran(jenis),
    triggerCode: TRIGGER_BY_JENIS[jenis],
    /**
     * Watermark terpisah per sumber (§4.3 komentar di khanza/penunjang.ts) --
     * lab dan radiologi tidak boleh berbagi satu cursor_ts.
     *
     * NAMANYA SENGAJA TIDAK IKUT BERUBAH jadi `LAB_RESULT`/`RAD_RESULT`, walau
     * sejak 034 ia tidak lagi cocok dengan kode pemicunya. Kunci ini identitas
     * BARIS di `poll_cursor`, bukan keterangan: menggantinya berarti
     * `getCursor` tidak menemukan barisnya, jatuh ke `now -
     * polling.lookback_days`, dan poller membaca ulang SEBULAN penuh hasil
     * pemeriksaan lalu mengirimkannya sebagai kabar baru. Ketidakcocokan nama
     * itu harga yang jauh lebih murah.
     */
    cursorKey: `RESULT_READY_${jenis.toUpperCase()}`,
    fetchRows: (cursorTs, lookbackDays) => pollResultReady(jenis, cursorTs, lookbackDays),
    getEventAt: (row) => parseSikDateTime(row.tgl_periksa, row.jam_terakhir),
    /**
     * §4.2: kunci (no_rawat, jenis, tgl_periksa) -- satu pesan per kunjungan
     * per hari per jenis.
     *
     * Prefiksnya tetap 'RESULT_READY', dengan alasan yang sama seperti
     * `cursorKey` di atas: kunci idempoten yang berubah berarti hasil yang
     * SUDAH pernah dikirim berhenti dikenali sebagai duplikat. `jenis` sudah
     * jadi bagian kuncinya sejak sebelum pemisahan, jadi lab dan radiologi
     * memang tidak pernah bertabrakan dan tidak ada yang perlu ditambahkan.
     */
    getIdempotencyKey: (row) => buildIdempotencyKey('RESULT_READY', row.no_rawat, jenis, row.tgl_periksa),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    getKdJenisPrw: (row) => row.kd_jenis_prw_list?.split(',') ?? [],
    getVars: (row) => varsResultReady(row, jenis),
  });
}

/** PRD F1 hasil penunjang selesai (kelas sisip, digabung per kunjungan). */
export async function runResultReadyCycle(): Promise<void> {
  await runOne('lab');
  await runOne('radiologi');
}
