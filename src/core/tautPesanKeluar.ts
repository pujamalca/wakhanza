/**
 * Mencocokkan pesan keluar yang dipantulkan WhatsApp dengan baris `outbox` yang
 * melahirkannya -- satu-satunya cara `message_ack` berikutnya punya sesuatu
 * untuk ditempeli.
 *
 * ## Kenapa modul ini ada
 *
 * Bentuk pertamanya satu baris di dalam pendengar event:
 *
 *   kandidat.find((r) => (r.chatId ? r.chatId === tujuan : `${r.phoneE164}@c.us` === tujuan))
 *
 * dan itu SALAH untuk setiap percakapan perorangan. Terukur di produksi
 * (17 Agustus 2026, jendela 30 hari):
 *
 *   | tujuan                | terkirim | tertaut |
 *   |-----------------------|----------|---------|
 *   | grup `@g.us`          |      755 |     447 |  <- 98,7% sejak 10 Agustus
 *   | petugas `@c.us`       |       86 |       0 |
 *   | pasien (nomor saja)   |       28 |       0 |
 *
 * **Nol dari 114 baris beralamat perorangan**, sementara grup nyaris sempurna.
 * Itu tanda tangan LID: WhatsApp memantulkan `to` percakapan perorangan sebagai
 * `<id>@lid`, identitas stabil yang SENGAJA tidak memuat nomor telepon (lihat
 * `core/waAddress.ts`), sehingga `${phoneE164}@c.us === tujuan` tidak pernah
 * benar. Grup tidak punya bentuk LID, jadi ia lolos. Cacat yang sama sudah
 * pernah dibayar di arah MASUK -- di sana ia membuang setiap pesan pasien dari
 * nomor yang sudah dipindahkan.
 *
 * ## Apa yang menggantikan pengaman yang hilang
 *
 * Alamat LID tidak memuat apa pun yang bisa dibandingkan dengan sebuah baris,
 * jadi pengaman keduanya harus berganti bentuk -- bukan dihapus. Yang
 * menggantikannya **KETUNGGALAN**, dan itu berdiri di atas sesuatu yang sudah
 * ada: setiap pesan keluar diakhiri kode pengiriman unik yang diturunkan dari
 * kunci idempotennya (`core/uniqueCode.ts`), sehingga dua baris tidak pernah
 * berisi teks yang sama. Diukur, bukan diandaikan: 888 baris 30 hari terakhir
 * menghasilkan 888 isi berbeda, dan NOL pasangan beridentik teks dalam jarak 30
 * menit satu sama lain.
 *
 * Karena itu daftar kandidat -- yang pemanggilnya sudah saring lewat isi persis,
 * `wa_message_id` kosong, dan jendela 30 menit -- praktis selalu berisi satu
 * baris. Bila ternyata lebih, satu-satunya sebab yang mungkin adalah kode
 * pengiriman dimatikan, dan di sana menebak salah satunya lebih buruk daripada
 * diam: konfirmasi yang ditempelkan ke baris yang keliru berbohong tentang
 * pasien yang keliru.
 *
 * ## Yang TIDAK dilonggarkan, dan ini pagarnya
 *
 * Kelonggaran ini berlaku HANYA saat alamat pantulannya `@lid`, dan hanya untuk
 * baris yang tujuannya memang perorangan. Alamat grup tetap dituntut cocok kata
 * demi kata. Tanpa batas itu, salinan ke grup dan pesan ke pasien -- yang pada
 * mode `pasien_dan_tujuan` bisa berisi teks yang sama persis -- bisa tertaut
 * silang, dan konfirmasi milik sebuah grup dilaporkan sebagai bukti bahwa
 * pasiennya menerima. Kebalikan dari guna fitur ini.
 *
 * Murni: tanpa database, tanpa whatsapp-web.js. Pemanggilnya yang menyediakan
 * daftar kandidat.
 */

import { isGroupAddress, isLidAddress, parseWaAddress } from './waAddress';

/** Bentuk minimal sebuah baris `outbox` yang dibutuhkan untuk mencocokkan tujuannya. */
export interface BarisTujuan {
  chatId: string | null;
  phoneE164: string | null;
}

export type SebabGagalTaut = 'tanpa-kandidat' | 'tak-cocok' | 'ambigu';

export type HasilTaut<T> = { baris: T } | { baris: null; sebab: SebabGagalTaut };

/**
 * Alamat lengkap yang dituju sebuah baris.
 *
 * Dua bentuk, dan bedanya bukan gaya: baris bertujuan grup/petugas menyimpan
 * alamat utuh di `chat_id`, sementara baris pasien hanya menyimpan nomornya dan
 * alamatnya baru dirakit dispatcher saat kirim.
 */
function alamatBaris(r: BarisTujuan): string | null {
  if (r.chatId) return r.chatId;
  return r.phoneE164 ? `${r.phoneE164}@c.us` : null;
}

/**
 * Apakah tujuan baris ini seorang PRIBADI (bukan grup).
 *
 * Baris pasien selalu pribadi. Baris bertujuan bisa keduanya -- tujuan farmasi
 * boleh berupa grup apotek maupun nomor petugas -- jadi yang menentukan
 * servernya, bukan ada-tidaknya `chat_id`.
 */
function barisPerorangan(r: BarisTujuan): boolean {
  const alamat = alamatBaris(r);
  if (!alamat) return false;
  return !isGroupAddress(alamat) && parseWaAddress(alamat) !== null;
}

/** Satu-satunya anggota daftar, atau null. Menegakkan ketunggalan di satu tempat. */
function tunggal<T>(daftar: readonly T[]): T | null {
  return daftar.length === 1 ? (daftar[0] ?? null) : null;
}

export function pilihBarisTertaut<T extends BarisTujuan>(kandidat: readonly T[], tujuan: string): HasilTaut<T> {
  if (kandidat.length === 0) return { baris: null, sebab: 'tanpa-kandidat' };

  // Kecocokan PERSIS selalu didahulukan, apa pun bentuk alamatnya. Ia satu-satunya
  // yang tidak bergantung pada asumsi apa pun tentang keunikan isi pesan.
  const persis = kandidat.filter((r) => alamatBaris(r) === tujuan);
  const persisTunggal = tunggal(persis);
  if (persisTunggal) return { baris: persisTunggal };
  if (persis.length > 1) return { baris: null, sebab: 'ambigu' };

  // Kelonggaran LID, dan HANYA untuk LID: bentuk alamat lain yang tidak cocok
  // memang tidak cocok. Yang membenarkannya adalah pengetahuan bahwa `@lid`
  // pasti perorangan -- bentuk asing tidak memberi pengetahuan apa pun, jadi ia
  // tidak boleh ikut mendapat kelonggarannya.
  if (!isLidAddress(tujuan)) return { baris: null, sebab: 'tak-cocok' };

  const perorangan = kandidat.filter(barisPerorangan);
  const peroranganTunggal = tunggal(perorangan);
  if (peroranganTunggal) return { baris: peroranganTunggal };
  if (perorangan.length > 1) return { baris: null, sebab: 'ambigu' };
  return { baris: null, sebab: 'tak-cocok' };
}
