import { pollPermintaan, type PermintaanRow, type PermintaanJenis } from '@/khanza/permintaanPenunjang';
import { buildIdempotencyKey } from '@/core/idempotency';
import { runSisipCycle } from './sisipCycle';
import { varsPermintaan } from './triggerVars';

function parseSikDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/**
 * Kode pemicu per jenis, BUKAN satu kode bersama seperti RESULT_READY.
 *
 * Di sana satu kode cukup karena pesannya memang sama dan `{jenis_layanan}`
 * membedakannya. Di sini yang menuntut pemisahan bukan isi pesannya melainkan
 * TUJUANNYA: sejak `template_target` (018), tujuan tambahan dipasang per
 * `trigger_code`. Satu kode bersama berarti grup Laboratorium dan grup
 * Radiologi tidak bisa dipisahkan -- keduanya menerima setiap permintaan,
 * termasuk yang bukan pekerjaannya.
 *
 * Akibat lain yang kebetulan menguntungkan: karena kodenya berbeda, watermarknya
 * juga berbeda dengan sendirinya -- tidak perlu `cursorKey` terpisah seperti
 * RESULT_READY, dan karena itu tidak ada kesempatan salah memasangkannya.
 */
const KODE: Record<PermintaanJenis, string> = {
  lab: 'LAB_REQUEST',
  radiologi: 'RAD_REQUEST',
};

async function runOne(jenis: PermintaanJenis): Promise<void> {
  const triggerCode = KODE[jenis];
  await runSisipCycle<PermintaanRow>({
    triggerCode,
    fetchRows: (cursorTs, lookbackDays) => pollPermintaan(jenis, cursorTs, lookbackDays),
    getEventAt: (row) => parseSikDateTime(row.tgl_permintaan, row.jam_permintaan),
    /**
     * Kunci per `noorder`, bukan per (no_rawat, tanggal) seperti RESULT_READY.
     *
     * Bedanya karena bentuk tabelnya: `periksa_lab` berisi satu baris per ITEM
     * pemeriksaan, sehingga panel darah lengkap menghasilkan belasan baris untuk
     * satu kunjungan dan wajib digabung supaya pasien tidak menerima belasan
     * WhatsApp. `permintaan_lab` sudah satu baris per PERMINTAAN (`noorder` PK),
     * jadi penggabungan yang sama justru salah: dua permintaan terpisah pada
     * hari yang sama -- yang memang terjadi saat dokter menambah pemeriksaan
     * susulan -- akan menyusut jadi satu pesan, dan yang kedua tidak pernah
     * diberitahukan.
     */
    getIdempotencyKey: (row) => buildIdempotencyKey(triggerCode, row.noorder),
    getNoRkmMedis: (row) => row.no_rkm_medis,
    getRawPhone: (row) => row.no_tlp,
    getKdPoli: (row) => row.kd_poli,
    // Kode pemeriksaan yang diminta -> F4.3. Satu kode sensitif saja cukup
    // membuat seluruh pesan diganti template generik (core/privacy.ts).
    getKdJenisPrw: (row) => row.kd_jenis_prw_list?.split(',') ?? [],
    getVars: (row) => varsPermintaan(row, jenis),
  });
}

/**
 * PERMINTAAN lab & radiologi (kelas sisip) -- pasangan RESULT_READY dari ujung
 * yang lain: yang ini saat pemeriksaan DIPESAN, yang itu saat hasilnya selesai.
 *
 * Keduanya menjaga sakelarnya sendiri lewat baris `template`-nya masing-masing
 * (`is_active`, bawaan MATI), jadi aman dipanggil tiap siklus tanpa syarat --
 * `runSisipCycle` berhenti di baris pertama saat templatenya nonaktif.
 */
export async function runPermintaanCycle(): Promise<void> {
  await runOne('lab');
  await runOne('radiologi');
}
