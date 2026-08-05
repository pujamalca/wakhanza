/**
 * Pemetaan baris `sik` -> variabel template, untuk ketujuh pemicu pasien.
 *
 * Ada di berkas tersendiri karena pemetaannya punya DUA pemanggil yang
 * berjauhan: poller sungguhan (`poller*.ts`, `scheduler.ts`) dan
 * `scripts/poll-dryrun.ts`. Sampai berkas ini ada, keduanya menuliskan
 * pemetaan yang sama dengan tangan -- dan ketika `{cara_bayar}` ditambahkan,
 * yang terjadi persis seperti yang sudah dibayar di `respectsOptOut()`,
 * `core/outboxStatus.ts`, dan `kunciPesanMasuk()`: satu sisi berubah, satu
 * sisi tidak.
 *
 * Yang membuatnya lebih berbahaya daripada penyimpangan biasa: yang tertinggal
 * adalah PRATINJAU-nya. `poll:dryrun` ada justru untuk menjawab "apa yang AKAN
 * terkirim" sebelum ada pesan sungguhan ke pasien, dan pratinjau yang
 * menampilkan variabel kosong sementara produksi mengisinya membuat staf
 * menyimpulkan variabelnya tidak jalan lalu membuangnya dari template.
 * Pratinjau yang berbohong lebih buruk daripada tanpa pratinjau -- alasan yang
 * sama membuat kotak "Uji coba" di dashboard memakai fungsi `core/` yang sama
 * dengan worker.
 *
 * SENGAJA tanpa `identityVars()`. Pemanggilnya menyisipkan identitas RS
 * sendiri (`sisipCycle.ts` untuk kelas sisip, `enqueueMessage()` sebagai
 * dasar), jadi menaruhnya di sini akan membuatnya tersisip dua kali dengan
 * dua sumber yang bisa berbeda.
 */
import type { TemplateVariable } from '@/core/template';
import { namaPenjamin } from '@/core/penjamin';
import type { QueueRegRow } from '@/khanza/antrian';
import type { ResultReadyRow, PenunjangJenis } from '@/khanza/penunjang';
import type { PharmacyReadyRow } from '@/khanza/farmasi';
import type { BillingReadyRow } from '@/khanza/billing';
import type { BookingRow } from '@/khanza/booking';

type Vars = Partial<Record<TemplateVariable, string>>;

/** Label {jenis_layanan} per sumber penunjang -- bukan nama pemeriksaannya (§5.2). */
export const JENIS_LAYANAN_PENUNJANG: Record<PenunjangJenis, string> = {
  lab: 'Laboratorium',
  radiologi: 'Radiologi',
};

export function varsQueueReg(row: QueueRegRow): Vars {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    no_antrian: row.no_reg,
    nama_poli: row.nm_poli ?? '',
    nama_dokter: row.nm_dokter ?? '',
    tanggal: row.tgl_registrasi,
    jam: row.jam_reg,
    cara_bayar: namaPenjamin(row.png_jawab),
  };
}

export function varsResultReady(row: ResultReadyRow, jenis: PenunjangJenis): Vars {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    nama_poli: row.nm_poli ?? '',
    tanggal: row.tgl_periksa,
    jam: row.jam_terakhir,
    jenis_layanan: JENIS_LAYANAN_PENUNJANG[jenis],
    cara_bayar: namaPenjamin(row.png_jawab),
    // jumlah_item TIDAK PERNAH ikut (§4.3: jumlah pemeriksaan pun petunjuk medis).
  };
}

export function varsPharmacyReady(row: PharmacyReadyRow): Vars {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    nama_poli: row.nm_poli ?? '',
    tanggal: row.tgl_penyerahan,
    jam: row.jam_penyerahan,
    jenis_layanan: 'Farmasi',
    cara_bayar: namaPenjamin(row.png_jawab),
  };
}

export function varsBillingReady(row: BillingReadyRow): Vars {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    tanggal: row.tanggal,
    jam: row.jam,
    jenis_layanan: 'Kasir',
    cara_bayar: namaPenjamin(row.png_jawab),
  };
}

/**
 * Dipakai BERSAMA oleh BOOK_CONFIRM, BOOK_CANCEL (`pollerBooking.ts`), dan
 * BOOK_REMIND (`scheduler.ts`) -- ketiganya membaca baris `booking_registrasi`
 * yang sama bentuknya, dan yang membedakan cuma pemicu mana yang mengambilnya.
 */
export function varsBooking(row: BookingRow): Vars {
  return {
    nama_pasien: row.nm_pasien ?? '',
    no_rm: row.no_rkm_medis,
    nama_poli: row.nm_poli ?? '',
    nama_dokter: row.nm_dokter ?? '',
    tanggal: row.tanggal_periksa,
    jam: row.jam_booking ?? '',
    cara_bayar: namaPenjamin(row.png_jawab),
  };
}
