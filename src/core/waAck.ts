/**
 * KONFIRMASI TERKIRIM -- arti tiap tingkat `message_ack` WhatsApp, dan aturan
 * bahwa tingkat itu hanya boleh MAJU.
 *
 * Sampai ini ada, status `sent` di `outbox` cuma berarti "WhatsApp menerima
 * titipannya" -- bukan "sampai ke penerima", apalagi "dibaca". Bedanya bukan
 * teoretis: kiriman ke JID grup yang SAMA SEKALI TIDAK ADA pun dijawab tanpa
 * galat dan berakhir `sent` (lihat FITUR.md, "Kode grup yang salah TETAP
 * berstatus sent"). Selama itu satu-satunya sinyal yang ada, pertanyaan yang
 * paling sering diajukan -- "pasiennya benar-benar dapat, tidak?" -- tidak bisa
 * dijawab sama sekali.
 *
 * Murni: tanpa database, tanpa whatsapp-web.js. Nilainya disalin dari enum
 * `MessageAck` pustaka itu dan dipatok uji supaya perubahan di sana tidak lolos
 * diam-diam.
 */

export const ACK_ERROR = -1;
export const ACK_PENDING = 0;
export const ACK_SERVER = 1;
export const ACK_DEVICE = 2;
export const ACK_READ = 3;
export const ACK_PLAYED = 4;

export type TingkatAck = -1 | 0 | 1 | 2 | 3 | 4;

const TINGKAT_SAH: readonly number[] = [ACK_ERROR, ACK_PENDING, ACK_SERVER, ACK_DEVICE, ACK_READ, ACK_PLAYED];

/**
 * Nilai di luar daftar DITOLAK, bukan disimpan apa adanya.
 *
 * WhatsApp bisa menambah tingkat baru kapan saja, dan menyimpan angka yang tidak
 * kita mengerti berarti dashboard menampilkan tingkat yang tidak punya
 * keterangan -- lebih buruk daripada kolom kosong, karena kosong sudah punya
 * arti sendiri yang benar ("belum ada kabar").
 */
export function isTingkatAck(nilai: unknown): nilai is TingkatAck {
  return typeof nilai === 'number' && TINGKAT_SAH.includes(nilai);
}

/**
 * Bolehkah `baru` menimpa `lama`.
 *
 * Event ack datang ASINKRON dan tidak dijamin berurutan: `ACK_READ` bisa tiba
 * sebelum `ACK_DEVICE` untuk pesan yang sama. Tanpa penjaga ini, sebuah pesan
 * yang sudah terbukti DIBACA bisa turun kembali jadi "sampai ke server" hanya
 * karena event yang lebih tua menyusul -- dan yang terlihat staf adalah
 * konfirmasi yang mundur sendiri.
 *
 * `ACK_ERROR` SELALU boleh menimpa, dan itu satu-satunya pengecualian: ia bukan
 * tingkat yang lebih rendah melainkan kabar bahwa pesannya gagal di sisi
 * WhatsApp. Menyembunyikannya karena angkanya kebetulan -1 berarti membuang
 * satu-satunya pemberitahuan kegagalan yang datang SESUDAH pengiriman dianggap
 * berhasil.
 */
export function ackBolehMenimpa(baru: TingkatAck, lama: number | null | undefined): boolean {
  if (baru === ACK_ERROR) return lama !== ACK_ERROR;
  if (lama === null || lama === undefined) return true;
  return baru > lama;
}

/**
 * Keterangan untuk staf. BERBEDA untuk grup, dan bedanya bukan kosmetik: di
 * percakapan perorangan `ACK_DEVICE` berarti sampai ke satu HP, sementara di
 * grup ia berarti sampai ke SELURUH anggota -- klaim yang jauh lebih kuat, dan
 * menyamakan kalimatnya membuat staf salah menyimpulkan ke dua arah.
 */
export function labelAck(tingkat: number | null | undefined, keGrup = false): string {
  switch (tingkat) {
    case ACK_ERROR:
      return 'Ditolak WhatsApp';
    case ACK_PENDING:
      return 'Menunggu di antrean WhatsApp';
    case ACK_SERVER:
      return 'Sampai ke server WhatsApp';
    case ACK_DEVICE:
      return keGrup ? 'Sampai ke semua anggota' : 'Sampai ke HP penerima';
    case ACK_READ:
      return keGrup ? 'Dibaca semua anggota' : 'Dibaca';
    case ACK_PLAYED:
      return 'Diputar';
    default:
      /**
       * Kolom kosong TIDAK berarti "tidak sampai", dan kalimatnya harus
       * mengatakan itu. Konfirmasi hanya tiba selama sesi hidup; pesan yang
       * dikirim sebelum worker dimulai ulang kemungkinan besar TIDAK pernah
       * mendapat ack-nya walau benar-benar diterima pasien. Menuliskannya
       * sebagai "belum sampai" akan membuat staf menelepon pasien yang
       * sebenarnya sudah membaca pesannya.
       */
      return 'Belum ada kabar';
  }
}

/** Apakah tingkat ini sudah membuktikan pesannya SAMPAI ke penerima (bukan cuma ke server). */
export function sudahSampai(tingkat: number | null | undefined): boolean {
  return typeof tingkat === 'number' && tingkat >= ACK_DEVICE;
}
