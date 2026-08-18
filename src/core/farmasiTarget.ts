/**
 * Mengubah apa yang DIKETIK staf menjadi alamat tujuan WhatsApp yang sah.
 *
 * Kenapa ini fungsi murni tersendiri dan bukan beberapa baris di server action:
 * tujuan yang salah GAGAL DIAM-DIAM. Nomor pasien yang salah masih ditolak
 * `getNumberId()` sebelum kirim, tapi JID grup yang salah bentuk cuma
 * menghasilkan satu baris `outbox` gagal per resep -- di halaman Antrean itu
 * terlihat persis seperti gangguan jaringan biasa, dan grup apoteknya tidak
 * pernah menerima apa pun tanpa seorang pun tahu kenapa.
 *
 * Karena itu seluruh penolakan di sini berbunyi kalimat yang bisa dibaca staf
 * pendaftaran, bukan "format tidak valid".
 */
import { normalizePhone } from './phone';

export type JenisTarget = 'grup' | 'personal';

export type HasilTarget = { ok: true; chatId: string; jenis: JenisTarget } | { ok: false; error: string };

/**
 * JID grup punya DUA bentuk yang keduanya masih beredar:
 *
 *   120363000000000000@g.us          grup yang dibuat sejak ~2021
 *   6281234567890-1614840000@g.us    bentuk lama: nomor pembuat + waktu dibuat
 *
 * Grup lama di rumah sakit yang sudah bertahun-tahun dipakai memakai bentuk
 * kedua, jadi menolaknya berarti menolak justru grup yang paling mungkin ingin
 * dipasang.
 */
const GRUP_BARU = /^\d{15,25}$/;
const GRUP_LAMA = /^\d{8,15}-\d{9,12}$/;

/**
 * Tautan undangan BUKAN JID, dan ini kekeliruan yang paling mungkin terjadi.
 *
 * "Salin tautan grup" adalah satu-satunya hal yang bisa disalin staf dari
 * aplikasi WhatsApp, jadi itulah yang akan ditempel ke kotak ini. Kodenya
 * (`https://chat.whatsapp.com/FGh7...`) sama sekali tidak berhubungan dengan
 * JID -- ia kode undangan, dan tidak ada cara menghitung JID darinya tanpa
 * benar-benar bergabung ke grup lewat sesi WhatsApp.
 *
 * Ditolak dengan menyebut jalan keluarnya, bukan cuma "tidak valid".
 */
const TAUTAN_UNDANGAN = /chat\.whatsapp\.com/i;

export function parseTargetGrup(masukan: string): HasilTarget {
  const teks = masukan.trim();
  if (teks === '') return { ok: false, error: 'Kode grup masih kosong.' };

  if (TAUTAN_UNDANGAN.test(teks)) {
    return {
      ok: false,
      error:
        'Itu tautan undangan grup, bukan kode grup. Keduanya berbeda dan tautan undangan tidak bisa dipakai di sini. ' +
        'Pakai tombol "Muat daftar grup" di atas — nomor WhatsApp rumah sakit harus sudah menjadi anggota grupnya.',
    };
  }

  // Akhiran @g.us boleh ada boleh tidak: staf yang menyalin dari daftar akan
  // membawanya, yang mengetik ulang biasanya tidak.
  const tanpaServer = teks.toLowerCase().endsWith('@g.us') ? teks.slice(0, -'@g.us'.length) : teks;

  if (tanpaServer.includes('@')) {
    return { ok: false, error: `"${teks}" bukan kode grup. Kode grup berakhiran @g.us, bukan yang lain.` };
  }

  if (!GRUP_BARU.test(tanpaServer) && !GRUP_LAMA.test(tanpaServer)) {
    return {
      ok: false,
      error:
        `"${teks}" tidak berbentuk kode grup. Yang benar berupa deretan angka panjang seperti ` +
        '120363000000000000@g.us. Paling aman: pakai tombol "Muat daftar grup".',
    };
  }

  return { ok: true, chatId: `${tanpaServer}@g.us`, jenis: 'grup' };
}

/**
 * Nomor petugas dinormalisasi lewat `normalizePhone()` yang SAMA dipakai
 * seluruh pipeline -- bukan disimpan apa adanya. Petugas mengetik `0812...`
 * sementara WhatsApp menuntut `62812...`, dan nomor yang tersimpan dalam bentuk
 * berbeda dari yang dipakai mengirim adalah cara paling rapi membuat satu
 * tujuan diam-diam tidak pernah menerima apa pun.
 */
export function parseTargetPersonal(masukan: string): HasilTarget {
  const teks = masukan.trim();
  if (teks === '') return { ok: false, error: 'Nomor masih kosong.' };

  if (teks.includes('@')) {
    return { ok: false, error: 'Isi nomor WhatsApp petugas saja, mis. 081234567890 — tanpa @c.us.' };
  }

  const hasil = normalizePhone(teks);
  if (!hasil.ok) {
    const sebab: Record<string, string> = {
      empty: 'Nomor masih kosong.',
      too_short: `"${teks}" terlalu pendek untuk sebuah nomor WhatsApp.`,
      not_mobile: `"${teks}" bukan nomor seluler. Notifikasi tidak bisa dikirim ke nomor telepon rumah.`,
      unparseable: `"${teks}" tidak terbaca sebagai nomor Indonesia. Contoh yang benar: 081234567890.`,
    };
    return { ok: false, error: sebab[hasil.reason] ?? `"${teks}" tidak terbaca sebagai nomor.` };
  }

  return { ok: true, chatId: `${hasil.value}@c.us`, jenis: 'personal' };
}

export function parseTarget(jenis: JenisTarget, masukan: string): HasilTarget {
  return jenis === 'grup' ? parseTargetGrup(masukan) : parseTargetPersonal(masukan);
}

/**
 * Bentuk yang enak dibaca di layar. Nomor personal ditampilkan sebagai nomor
 * biasa lagi (bukan JID), karena itulah bentuk yang dikenali staf saat
 * mencocokkan "ini nomor siapa".
 */
export function tampilkanChatId(chatId: string): string {
  if (chatId.endsWith('@c.us')) return chatId.slice(0, -'@c.us'.length);
  return chatId;
}

/** Penjaga terakhir sebelum sebuah nilai dari database diserahkan ke WhatsApp. */
export function isChatIdValid(chatId: string): boolean {
  if (chatId.endsWith('@g.us')) return parseTargetGrup(chatId).ok;
  if (chatId.endsWith('@c.us')) return parseTargetPersonal(tampilkanChatId(chatId)).ok;
  return false;
}
