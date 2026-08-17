import type { Message } from 'whatsapp-web.js';
import { InboundMessage, Outbox, getSettingBool, type JenisChat } from '@/models';
import { logger, safeError, maskChatId } from '@/lib/logger';
import { isGroupAddress, kunciPesanMasuk, phoneFromAddress } from '@/core/waAddress';

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
        // Cadangan `from:timestamp` untuk pesan yang tidak membawa id -- tanpa
        // nilai, UNIQUE KEY-nya justru menolak baris kedua mana pun dan seluruh
        // pencatatan berhenti diam-diam. Lewat `kunciPesanMasuk()` supaya sama
        // persis dengan yang dipakai balasan otomatis dan balasan stok grup.
        waMessageId: kunciPesanMasuk(message).slice(0, 160),
        chatId: message.from.slice(0, 64),
        jenis: info.jenis,
        arah: 'masuk',
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

/**
 * Mencatat satu balasan yang DIKETIK MANUSIA dari ponsel nomor rumah sakit.
 *
 * Dipanggil dari pendengar `message_create` hanya setelah
 * `layakCatatSebagaiBalasanManual()` mengizinkan -- baca modul itu untuk kedua
 * pagar pertamanya berikut pengukuran yang melahirkan fitur ini.
 *
 * ## Pagar ketiga, dan ia tidak bisa tinggal di fungsi murni itu
 *
 * `tanpa-kandidat` berarti "tidak ada baris `outbox` beridentik isi DALAM 30
 * MENIT terakhir" -- bukan "tidak ada sama sekali". Bedanya menggigit pada satu
 * keadaan yang benar-benar terjadi tiap hari: pesan yang tertahan jam tenang.
 * Ia masuk antrean pukul 22:00 dan baru berangkat pukul 07:00, sembilan jam di
 * luar jendela, sehingga pantulannya terbaca sebagai ketikan manusia dan
 * gelembungnya muncul dua kali di percakapan.
 *
 * Karena itu isinya diperiksa sekali lagi terhadap SELURUH `outbox`, tanpa
 * batas waktu. Aman justru karena kode pengiriman unik per pesan
 * (`core/uniqueCode.ts`): dua baris tidak pernah beridentik teks, jadi
 * kecocokan berarti pesan ini memang lahir di sini. Ongkosnya satu kueri per
 * pesan manusia -- terukur di bawah sepuluh sehari, sementara yang dibayar
 * kalau dilewatkan adalah catatan percakapan yang berbohong.
 *
 * TIDAK PERNAH melempar, alasan yang sama dengan `catatPesanMasuk()`.
 */
export async function catatPesanKeluarManual(message: Message, waMessageId: string): Promise<void> {
  try {
    const tujuan = message.to ?? '';
    const teks = message.body ?? '';

    if (await Outbox.findOne({ where: { body: teks }, attributes: ['id'] })) {
      logger.debug(
        { tujuan: maskChatId(tujuan) },
        'pesan keluar cocok dengan baris outbox di luar jendela penautan -- buatan sistem, tidak dicatat sebagai balasan manual',
      );
      return;
    }

    const simpanTeks = await getSettingBool('inbox.simpan_teks', true);
    const grup = isGroupAddress(tujuan);

    await InboundMessage.create(
      {
        waMessageId: waMessageId.slice(0, 160),
        chatId: tujuan.slice(0, 64),
        jenis: grup ? 'grup' : 'perorangan',
        arah: 'keluar',
        // Pengirimnya KAMI. Menuliskan alamat nomor rumah sakit di sini tidak
        // menambah apa pun -- ia sama untuk setiap baris keluar -- sementara
        // kolomnya sudah punya arti tegas ("id user yang dicari orang").
        pengirimId: null,
        // Hanya terisi untuk `@c.us`. Percakapan perorangan di mesin ini
        // seluruhnya `@lid`, yang memang tidak memuat nomor; menanyakannya ke
        // WhatsApp berarti menembus Chromium demi kolom yang tidak dipakai
        // mencari apa pun -- percakapannya sudah bergabung lewat `chat_id`.
        phoneE164: phoneFromAddress(tujuan),
        // Nama pengirim tidak berlaku: yang mengetik petugas rumah sakit, dan
        // WhatsApp tidak memberi tahu petugas yang mana.
        namaKontak: null,
        namaChat: grup ? ((await namaGrup(message))?.slice(0, 160) ?? null) : null,
        tipe: String(message.type ?? 'unknown').slice(0, 24),
        teks: simpanTeks ? teks : null,
        panjangTeks: teks.length,
        // Tidak berlaku untuk baris keluar, dan itulah sebabnya SETIAP kueri
        // "belum dibalas" wajib menyaring `arah: 'masuk'` -- tanpa itu balasan
        // kita sendiri ikut terhitung sebagai pertanyaan yang menunggu jawaban.
        dibalas: false,
      },
      // Sesi yang dipulihkan menyerahkan ulang pesan lama, termasuk yang keluar.
      { ignoreDuplicates: true },
    );

    /**
     * `info`, dan itu tidak akan menenggelamkan apa pun: terukur di bawah
     * sepuluh sehari. Yang dibelinya, pertanyaan "apakah balasan petugas
     * benar-benar tercatat" bisa dijawab dari log tanpa membuka database --
     * dan bila WhatsApp suatu saat mengubah bentuk pantulannya lagi, senyapnya
     * baris ini yang akan memberi tahu, bukan petugas yang kebetulan sadar
     * percakapannya kembali sebelah. Isinya TIDAK pernah ikut (§9.7).
     */
    logger.info(
      { tujuan: maskChatId(tujuan), jenis: grup ? 'grup' : 'perorangan', panjangTeks: teks.length },
      'balasan yang diketik dari ponsel tercatat ke percakapan',
    );
  } catch (err) {
    logger.error({ to: maskChatId(message.to ?? ''), ...safeError(err) }, 'gagal mencatat balasan manual');
  }
}
