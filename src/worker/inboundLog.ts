import type { Message } from 'whatsapp-web.js';
import { InboundMessage, getSettingBool, type JenisChat } from '@/models';
import { logger, safeError, maskChatId } from '@/lib/logger';

/**
 * Mencatat SETIAP pesan masuk perorangan dan grup ke `inbound_message`.
 *
 * Dipanggil dari pendengar `client.on('message')` dan sengaja diletakkan
 * SESUDAH balasan otomatis memutuskan: tabelnya tidak punya grant `UPDATE`
 * (baris catatan tidak pernah ditulis ulang), jadi `dibalas` harus sudah
 * diketahui saat baris ditulis alih-alih ditambal belakangan.
 *
 * TIDAK PERNAH melempar. Kegagalan mencatat tidak boleh menjatuhkan penanganan
 * pesan masuk -- yang hilang cukup satu baris di daftar, bukan balasan ke
 * pasien yang sedang menunggu.
 */
export interface CatatanMasuk {
  jenis: JenisChat;
  phoneE164: string | null;
  dibalas: boolean;
}

/**
 * Nama grup dibaca lewat `getChat()`, dan HANYA untuk grup.
 *
 * Satu panggilan tambahan per pesan grup; untuk perorangan tidak ada gunanya
 * (namanya sudah ada di `notifyName`). Dibungkus try/catch karena ia menembus
 * Chromium: grup yang metadatanya belum tersinkron melempar, dan itu tidak
 * boleh membuat pesannya hilang dari daftar -- halaman tetap bisa menampilkan
 * namanya dari `wa_group`.
 */
async function namaGrup(message: Message): Promise<string | null> {
  try {
    const chat = await message.getChat();
    return chat?.name ?? null;
  } catch (err) {
    logger.debug({ ...safeError(err) }, 'nama grup tidak terbaca');
    return null;
  }
}

export async function catatPesanMasuk(message: Message, info: CatatanMasuk): Promise<void> {
  try {
    const simpanTeks = await getSettingBool('inbox.simpan_teks', true);
    const teks = message.body ?? '';
    const grup = info.jenis === 'grup';

    await InboundMessage.create(
      {
        // Cadangan `from:timestamp` untuk pesan yang entah bagaimana tidak
        // membawa id -- tanpa nilai, UNIQUE KEY-nya justru menolak baris kedua
        // mana pun dan seluruh pencatatan berhenti diam-diam.
        waMessageId: (message.id?._serialized ?? `${message.from}:${message.timestamp}`).slice(0, 160),
        chatId: message.from.slice(0, 64),
        jenis: info.jenis,
        // Di grup, pengirimnya adalah PESERTA, bukan grupnya. Inilah "id user"
        // yang dicari orang saat membuka halaman ini.
        pengirimId: (grup ? (message.author ?? null) : message.from)?.slice(0, 64) ?? null,
        phoneE164: info.phoneE164,
        // notifyName = nama yang dipasang sendiri oleh pengirim di WhatsApp.
        // Dibaca dari muatan pesan, bukan lewat getContact() -- itu menembus
        // Chromium dan tidak sepadan untuk sekadar label di layar.
        namaKontak:
          (message as unknown as { _data?: { notifyName?: string } })._data?.notifyName?.slice(0, 120) ?? null,
        namaChat: grup ? ((await namaGrup(message))?.slice(0, 160) ?? null) : null,
        tipe: String(message.type ?? 'unknown').slice(0, 24),
        teks: simpanTeks ? teks : null,
        // Selalu diisi walau teksnya tidak disimpan: tanpa ini, "pertanyaan
        // panjang dari pasien" tidak bisa dibedakan dari "stiker" saat
        // penyimpanan teks dimatikan -- padahal itu justru yang menentukan
        // apakah ada yang harus dibalas manusia.
        panjangTeks: teks.length,
        dibalas: info.dibalas,
      },
      // whatsapp-web.js menyerahkan ulang pesan lama tiap sesi dipulihkan.
      { ignoreDuplicates: true },
    );
  } catch (err) {
    logger.error({ from: maskChatId(message.from), ...safeError(err) }, 'gagal mencatat pesan masuk');
  }
}
