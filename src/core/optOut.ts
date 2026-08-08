import { normalizeInbound } from './autoReply';

/**
 * Berhenti berlangganan: frasanya, dan SEJAUH MANA ia mengikat.
 *
 * Sampai sebelumnya opt-out berlaku untuk segalanya: sekali pasien mengirim
 * "STOP", tidak ada pesan apa pun lagi yang keluar untuk nomor itu. Sekarang
 * cakupannya sengaja dipersempit ke pemicu OTOMATIS KE PASIEN saja -- itulah
 * arti frasanya yang baru, dan itulah yang dijanjikan ke pasien. Jumlahnya
 * sengaja tidak disebut di sini; ia bertambah tiap ada pemicu pasien baru, dan
 * angka yang ditulis di prosa adalah angka yang cepat atau lambat basi.
 */

/**
 * Frasa yang dikenali. Menggantikan "STOP"/"berhenti"/"unsubscribe" yang
 * dipakai sebelumnya.
 *
 * Tiga kata, bukan satu, dan itu yang membuatnya boleh dicocokkan sebagai
 * BAGIAN dari kalimat alih-alih harus sama persis dengan seluruh pesan. Pola
 * lama `^(stop|berhenti)$` terpaksa ketat karena satu kata seperti "berhenti"
 * gampang muncul di kalimat biasa -- akibatnya "stop dong" dan "saya mau
 * berhenti" TIDAK berhenti, padahal maksud pasiennya jelas. Frasa sepanjang
 * ini praktis tidak mungkin terketik tanpa sengaja, jadi pencocokan yang lebih
 * longgar justru lebih aman sekaligus lebih memaafkan.
 */
export const OPT_OUT_PHRASE = 'Berhenti Kirim Otomatis';

/**
 * Pemicu yang TUNDUK pada opt-out: notifikasi otomatis KE PASIEN yang berangkat
 * dari kejadian di sik tanpa ada manusia yang menekan apa pun.
 *
 * Yang TIDAK ada di sini, dan itu disengaja:
 *
 * - BROADCAST / broadcast terjadwal -- pengumuman yang disusun staf. Secara
 *   kebijakan ini kanal yang berbeda dari notifikasi kunjungan, dan rumah
 *   sakit memutuskan keduanya dipisah.
 * - AUTO_REPLY -- jawaban atas pesan yang pasiennya sendiri kirim barusan.
 *   Mendiamkan orang yang baru saja bertanya bukan menghormati permintaannya,
 *   melainkan membuat sistem tampak rusak.
 * - FARMASI_VALIDASI / FARMASI_PENYERAHAN -- tidak dikirim ke pasien sama
 *   sekali, melainkan ke grup/petugas apotek. Tidak ada nomor pasien yang bisa
 *   dicocokkan ke daftar tolak, dan seorang pasien tidak bisa memberhentikan
 *   koordinasi kerja internal rumah sakit. Ini kasus yang paling jelas dari
 *   ketiganya, dan justru karena itu paling gampang lolos tanpa dipikirkan.
 * - FARMASI_STOK_DARURAT -- peringatan persediaan gudang. Alasan yang sama
 *   seperti dua pemicu farmasi di atas, ditambah satu yang lebih telanjang
 *   lagi: isinya tidak menyebut seorang pasien pun. Tidak ada yang bisa
 *   diberhentikan atas nama siapa.
 * - BPJS_BATAL -- pembatalan Mobile JKN, dikirim ke loket/pendaftaran supaya
 *   slotnya bisa ditawarkan ke pasien lain. Tidak ada nomor pasien untuk
 *   dicocokkan, alasan yang sama dengan ketiga pemicu farmasi.
 *
 * BPJS_KONTROL ADA di dalam daftar, dan itu bukan pilihan bebas: ia pengingat
 * otomatis KE PASIEN yang berangkat dari data di sik tanpa ada manusia yang
 * menekan apa pun -- persis definisi ketujuh pemicu lain. Pasien yang sudah
 * meminta berhenti lalu tetap menerima pengingat kontrol akan membaca frasa
 * yang dijanjikan sistem sebagai bohong, dan itu merusak seluruh mekanismenya,
 * bukan cuma satu pesan.
 *
 * Konsekuensinya HARUS tercermin di teks yang dibaca pasien: janji yang
 * diberikan saat ia berhenti tidak boleh lebih luas dari yang benar-benar
 * dijalankan mesin. Lihat OPT_OUT_CONFIRMATION di worker/wa-client.ts.
 */
const OPT_OUT_TRIGGERS = new Set([
  'QUEUE_REG',
  'BOOK_CONFIRM',
  'BOOK_CANCEL',
  'BOOK_REMIND',
  // Hasil penunjang, dipisah per jenis sejak migrations/034. KEDUANYA terikat,
  // dan itu bukan sekadar menyalin baris lama dua kali: pasangan yang satu
  // berhenti sementara satunya terus mengirim akan terbaca pasien sebagai
  // permintaannya diabaikan sebagian -- alasan yang sama persis yang membuat
  // LAB_REQUEST/RAD_REQUEST dan KONTROL_TERBIT/KONTROL_ULANG masuk berpasangan.
  'LAB_RESULT',
  'RAD_RESULT',
  'PHARMACY_READY',
  'BILLING_READY',
  'BPJS_KONTROL',
  /**
   * KONTROL_ULANG -- pengingat surat kontrol untuk pasien NON-BPJS
   * (migrations/032). Ada di sini lewat alasan yang identik dengan
   * BPJS_KONTROL tepat di atasnya, dan justru karena keduanya sepasang maka
   * ketidaksamaannya akan jadi janji yang mustahil dijelaskan: pasien yang
   * sudah meminta berhenti lalu tetap diingatkan hanya karena suratnya
   * kebetulan tidak lewat bridging BPJS akan membaca frasa yang dijanjikan
   * sistem sebagai bohong.
   */
  'KONTROL_ULANG',
  /**
   * KONTROL_TERBIT -- pemberitahuan saat surat kontrolnya disimpan
   * (migrations/033), pasangan KONTROL_ULANG dari ujung yang lain. Terikat
   * lewat alasan yang sama, dan sekali lagi karena PASANGAN: pemicu yang satu
   * berhenti sementara satunya terus mengirim surat yang sama akan terbaca
   * pasien sebagai permintaannya diabaikan sebagian.
   */
  'KONTROL_TERBIT',
  // Permintaan lab/radiologi: pemberitahuan otomatis dari kejadian di sik ke
  // nomor pasien, sekelas dengan yang di atasnya. Pasangan LAB_RESULT/RAD_RESULT
  // -- dan pasangan yang satu terikat sementara satunya tidak akan jadi janji
  // yang mustahil dijelaskan ke pasien yang sudah meminta berhenti.
  'LAB_REQUEST',
  'RAD_REQUEST',
  /**
   * SURAT_SAKIT (pengiriman surat OTOMATIS) ADA di sini, sementara ADMINISTRASI
   * (kirim manual atas surat yang sama) TIDAK -- dan itu justru inti dari
   * kenapa keduanya diberi kode pemicu berbeda alih-alih satu kode dipakai dua
   * jalur.
   *
   * Yang dihentikan pasien lewat frasa "Berhenti Kirim Otomatis" adalah
   * kiriman yang datang tanpa ia minta. Surat yang dikirimkan petugas karena
   * pasiennya sendiri yang meminta di loket bukan itu; surat yang dikirim
   * mesin begitu dokternya menyimpan, tanpa ada yang meminta, persis itu.
   * Menumpang satu kode akan memaksa keduanya sama, dan ke arah mana pun
   * salahnya: mendiamkan orang yang baru saja meminta suratnya, atau tetap
   * mengirimi berkas orang yang sudah bilang berhenti.
   */
  'SURAT_SAKIT',
  /**
   * PENINGGALAN. Sejak migrations/034 tidak ada lagi pemicu berkode
   * RESULT_READY -- ia dipecah jadi LAB_RESULT dan RAD_RESULT di atas.
   *
   * Tetap di sini karena daftar ini dipakai untuk DUA hal, dan yang kedua
   * menyentuh baris lama: `respectsOptOut()` saat enqueue (kode ini tidak akan
   * pernah muncul lagi), TAPI juga pencoretan antrean di `wa-client.ts` yang
   * mencari baris `outbox` berstatus `pending`. Baris RESULT_READY yang
   * terlanjur mengantre sebelum migrasi harus tetap tercoret saat pasiennya
   * meminta berhenti; membuangnya dari daftar berarti pesan lolos ke orang yang
   * sudah bilang berhenti, karena kodenya kebetulan sudah tidak dipakai lagi.
   */
  'RESULT_READY',
]);

/**
 * Satu-satunya sumber kebenaran untuk "apakah pemicu ini berhenti bila pasien
 * opt-out". Dipakai saat ENQUEUE dan sekali lagi tepat sebelum KIRIM -- kalau
 * kedua tempat itu menafsirkannya sendiri-sendiri, cukup satu yang lupa
 * diperbarui untuk membuat pesan lolos ke pasien yang sudah minta berhenti.
 */
export function respectsOptOut(triggerCode: string): boolean {
  return OPT_OUT_TRIGGERS.has(triggerCode);
}

/** Daftar pemicu terikat, untuk ditampilkan di dashboard tanpa menyalin daftarnya. */
export function optOutTriggerCodes(): string[] {
  return [...OPT_OUT_TRIGGERS];
}

const PHRASE_NORMALIZED = normalizeInbound(OPT_OUT_PHRASE);

/**
 * Cocok bila frasanya muncul sebagai rangkaian KATA UTUH di mana pun dalam
 * pesan. Huruf besar-kecil, tanda baca, dan emoji sudah dibuang normalisasi,
 * jadi "BERHENTI KIRIM OTOMATIS!", "berhenti kirim otomatis", dan "saya mau
 * berhenti kirim otomatis ya" sama-sama diterima.
 *
 * Penyelubungan spasi mencegah kecocokan di tengah kata -- alasan yang sama
 * seperti di core/autoReply.ts.
 */
export function isOptOutRequest(text: string): boolean {
  const normalized = normalizeInbound(text);
  if (!normalized) return false;
  return ` ${normalized} `.includes(` ${PHRASE_NORMALIZED} `);
}
