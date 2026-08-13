import type { OutboxStatus, WaSessionStatus } from '@/models';
import type { BadgeVariant } from './Badge';

/**
 * Terjemahan istilah mesin ke bahasa yang dibaca petugas.
 *
 * Nilai seperti `skipped_no_contact`, `failed_permanent`, atau `QUEUE_REG`
 * adalah kunci enum/kode pemicu -- bentuk yang benar untuk database, log, dan
 * kunci idempoten, tapi tidak untuk petugas pendaftaran yang membuka dashboard.
 * Semua label di sini MURNI presentasi: tidak ada satu pun yang dipakai untuk
 * perbandingan, penyaringan, atau disimpan. Kode aslinya tetap ditampilkan
 * berdampingan (atribut `title` atau kolom terpisah) supaya tiket dukungan dan
 * baris log masih bisa dicocokkan.
 */

export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = {
  pending: 'Menunggu',
  sending: 'Sedang dikirim',
  sent: 'Terkirim',
  failed: 'Gagal, berhenti dicoba',
  failed_permanent: 'Gagal permanen',
  skipped_no_contact: 'Tanpa nomor',
  skipped_opt_out: 'Berhenti otomatis',
  skipped_uji_terbatas: 'Tertahan jatah uji',
  expired: 'Kedaluwarsa',
};

/** Kalimat penjelas -- dipakai sebagai `title` dan pada keadaan kosong. */
export const OUTBOX_STATUS_HELP: Record<OutboxStatus, string> = {
  pending: 'Sudah masuk antrean, menunggu giliran kirim atau menunggu jam tenang berakhir.',
  sending: 'Sedang dikirim worker saat ini.',
  sent: 'Sudah diserahkan ke WhatsApp.',
  // Label lamanya berbunyi "masih akan dicoba ulang otomatis" dan itu keliru:
  // dispatcher hanya mengambil baris `pending`, jadi tidak ada yang pernah
  // menyentuhnya lagi. Status ini tidak ditulis lagi sejak percobaan-habis
  // diperbaiki jadi `failed_permanent`; teks ini untuk baris peninggalan.
  failed: 'Percobaan kirim habis dan sudah berhenti dicoba. Perlu ditinjau, bisa dikirim ulang manual.',
  failed_permanent: 'Semua percobaan habis. Perlu ditinjau, bisa dikirim ulang manual.',
  skipped_no_contact: 'Pasien tidak punya nomor yang bisa dipakai. Perbaiki lewat halaman Nomor bermasalah.',
  skipped_opt_out:
    'Pasien meminta berhenti menerima pemberitahuan otomatis, jadi jenis pesan ini sengaja tidak dikirimi. Pengumuman broadcast dan balasan otomatis tidak terpengaruh.',
  skipped_uji_terbatas:
    'Pemicu ini sedang dibatasi mode uji terbatas dan jatah pasien hari ini sudah habis, jadi pesannya tidak dikirim. Naikkan batasnya di halaman Template bila memang sudah siap melayani lebih banyak. Pesan yang tertahan TIDAK dikirim susulan -- kejadiannya sudah lewat.',
  expired: 'Kejadiannya sudah terlalu lama saat giliran kirim tiba, jadi dibatalkan agar pasien tidak menerima kabar basi.',
};

/**
 * Pembungkus untuk `Outbox.status`, yang bertipe `CreationOptional<OutboxStatus>`
 * (tipe bermerek Sequelize) dan karena itu tidak bisa dipakai langsung sebagai
 * indeks `Record<OutboxStatus, …>`. Sekalian memberi jalan aman bila suatu saat
 * ada nilai enum baru yang belum punya terjemahan: kodenya ditampilkan apa
 * adanya, bukan `undefined`.
 */
export function outboxStatusLabel(status: string): string {
  return OUTBOX_STATUS_LABEL[status as OutboxStatus] ?? status;
}

export function outboxStatusHelp(status: string): string | undefined {
  return OUTBOX_STATUS_HELP[status as OutboxStatus];
}

/**
 * Cerminan `template.label` yang di-seed di `migrations/002`. Sengaja statis,
 * bukan hasil join ke tabel `template`: halaman Antrean dan Log menampilkan
 * ribuan baris (satu join tambahan per halaman tanpa manfaat), dan `BROADCAST`
 * memang tidak punya baris `template` sama sekali. Kalau admin mengganti
 * `template.label`, yang berubah adalah judul kartu di halaman Template --
 * daftar di sini tetap istilah tetap untuk penamaan jenis pesan.
 */
export const TRIGGER_LABEL: Record<string, string> = {
  BOOK_CONFIRM: 'Konfirmasi booking',
  BOOK_REMIND: 'Pengingat H-1',
  BOOK_CANCEL: 'Booking batal',
  QUEUE_REG: 'Nomor antrian',
  // Hasil penunjang, dipisah per jenis sejak migrations/034. Labelnya menyebut
  // "permintaan" versus "hasil" secara eksplisit supaya keempatnya tidak
  // tertukar di Antrean -- semuanya menyangkut kunjungan dan pasien yang sama
  // pada hari yang sama, dan yang dicari orang saat menelusuri justru pemicu
  // MANA yang mengirim.
  LAB_RESULT: 'Hasil lab',
  RAD_RESULT: 'Hasil radiologi',
  LAB_REQUEST: 'Permintaan lab',
  RAD_REQUEST: 'Permintaan radiologi',
  /**
   * Baris PENINGGALAN, dan sengaja tidak dihapus. Sejak migrations/034 tidak
   * ada lagi pemicu berkode ini, tapi baris `outbox` dan `send_log` yang
   * terlanjur tercatat dengannya tetap ada -- riwayat tidak ditulis ulang.
   * Tanpa baris ini halaman Antrean dan Log menampilkan kode mentah untuk
   * pesan yang dulu benar-benar terkirim ke pasien.
   *
   * TRIGGER_SOURCE sengaja TIDAK punya padanannya: yang itu menjelaskan baris
   * `template` yang ADA, dan `labels.test.ts` menolak keterangan untuk pemicu
   * yang tidak ada. Ketidaksamaan kedua daftar ini disengaja, bukan kelalaian.
   */
  RESULT_READY: 'Hasil penunjang (lama)',
  PHARMACY_READY: 'Obat siap',
  BILLING_READY: 'Tagihan',
  BROADCAST: 'Broadcast',
  AUTO_REPLY: 'Balasan otomatis',
  // Dua-duanya BUKAN pesan ke pasien. Labelnya menyebut "apotek" secara
  // eksplisit supaya baris di halaman Antrean dan Log tidak terbaca sebagai
  // pemberitahuan yang gagal sampai ke pasien -- penerimanya memang staf.
  FARMASI_VALIDASI: 'Apotek: resep divalidasi',
  FARMASI_PENYERAHAN: 'Apotek: obat diserahkan',
  // Rekap harian atas KEDUA baris di atasnya (042). Labelnya menyebut "rekap"
  // dan "harian" sekaligus, dengan alasan yang sama yang memisahkan bunyi
  // FARMASI_PENJUALAN dari FARMASI_PENJUALAN_REKAP: tiga baris apotek yang
  // berdampingan di Antrean harus bisa dibedakan sekali baca, dan yang
  // membedakan ketiganya bukan isinya melainkan APAKAH ia satu kejadian atau
  // sehari penuh.
  FARMASI_RESEP_REKAP: 'Apotek: rekap resep harian',
  FARMASI_UJI: 'Apotek: pesan uji',
  FARMASI_STOK_DARURAT: 'Apotek: persediaan menipis',
  // Keempat NOTA BARANG, diurutkan seperti tabnya di /farmasi. Labelnya
  // sengaja menyebut KEJADIANNYA, bukan cuma nama menunya, dan itu pelajaran
  // KONTROL_ULANG/KONTROL_TERBIT yang sama: "nota pengadaan" dan "nota
  // pemesanan" berdampingan di satu tabel Antrean praktis tidak bisa
  // dibedakan, padahal keduanya dua ujung berlawanan dari satu alur (yang satu
  // barangnya SUDAH datang, yang satu baru DIPESAN). Yang dicari orang saat
  // menelusuri justru pemicu MANA yang mengirim.
  FARMASI_PENGADAAN: 'Apotek: barang datang (pembelian)',
  FARMASI_PEMESANAN: 'Apotek: pesanan ke pemasok',
  FARMASI_HIBAH: 'Apotek: barang datang (hibah)',
  // Sepasang, dan labelnya sengaja BERLAWANAN BUNYI. Keduanya menyangkut nota
  // yang sama pada dua saat yang berbeda, jadi baris berdampingan di Antrean
  // harus bisa dibedakan sekali baca -- pelajaran KONTROL_ULANG/KONTROL_TERBIT.
  FARMASI_PENJUALAN: 'Apotek: nota penjualan',
  FARMASI_PENJUALAN_HAPUS: 'Apotek: nota penjualan DIBATALKAN',
  FARMASI_PENJUALAN_REKAP: 'Apotek: rekap penjualan harian',
  // Awalan "ERM:" sengaja dipakai sejak pemicu PERTAMA di keluarga itu, bukan
  // ditambahkan belakangan saat yang kedua datang. Menu ini direncanakan tumbuh
  // mengikuti 31 tabel asesmen Khanza, dan mengganti awalan pada baris `outbox`
  // yang sudah terlanjur tercatat adalah persis yang TIDAK bisa dilakukan --
  // riwayat tidak ditulis ulang (pelajaran RESULT_READY di migrations/034).
  //
  // Penerimanya PERAWAT, bukan pasien, dan labelnya menyebut itu lewat kata
  // "rekap": baris di Antrean/Log tidak boleh terbaca sebagai pemberitahuan yang
  // gagal sampai ke pasien padahal memang tidak pernah ditujukan ke sana.
  ERM_PENILAIAN_UMUM: 'ERM: rekap asesmen awal',
  // BPJS_BATAL ke loket, BPJS_KONTROL ke pasien -- dan bedanya ditulis di
  // labelnya, dengan alasan yang sama seperti ketiga baris apotek di atas:
  // baris di Antrean/Log tidak boleh terbaca sebagai pemberitahuan yang gagal
  // sampai ke pasien padahal penerimanya memang staf.
  BPJS_BATAL: 'BPJS: pembatalan Mobile JKN',
  BPJS_KONTROL: 'BPJS: pengingat kontrol',
  // Padanan BPJS_KONTROL dari sisi Khanza sendiri. Labelnya WAJIB menyebut
  // "non-BPJS" secara eksplisit: dua baris berdampingan di Antrean yang
  // sama-sama berbunyi "pengingat kontrol" tidak bisa dibedakan sama sekali,
  // dan yang dicari orang saat menelusuri justru pemicu MANA yang mengirim.
  KONTROL_ULANG: 'Pengingat kontrol (non-BPJS)',
  // Pasangan baris di atasnya. Labelnya menyebut "dibuat" versus "Pengingat"
  // supaya baris di Antrean bisa dibedakan -- keduanya menyangkut SURAT dan
  // pasien yang sama, cuma pada dua saat yang berbeda.
  KONTROL_TERBIT: 'Surat kontrol dibuat (non-BPJS)',
  // Satu-satunya baris yang membawa BERKAS, bukan kabar. Labelnya menyebut
  // "dokumen" supaya jelas dari halaman Antrean bahwa yang gagal terkirim
  // bukan sekadar pemberitahuan yang bisa diulang isinya -- ada surat yang
  // tidak sampai, dan pasiennya kemungkinan sedang menunggunya.
  ADMINISTRASI: 'Dokumen surat',
  // Surat yang SAMA, jalur yang berbeda -- dan labelnya wajib membedakannya
  // karena keduanya berdampingan di halaman Antrean untuk pasien yang sama.
  // Tanpa itu, "kenapa pasien ini dapat suratnya dua kali" tidak bisa dijawab
  // dari layar: yang satu dikirim petugas, yang satu dikirim mesin.
  SURAT_SAKIT: 'Surat sakit (otomatis)',
};

/** Kode yang belum dikenal dikembalikan apa adanya, bukan jadi string kosong. */
export function triggerLabel(code: string): string {
  return TRIGGER_LABEL[code] ?? code;
}

export interface TriggerSource {
  /** Tabel Khanza yang dibaca poller-nya, persis sebagaimana muncul di FROM. */
  tabel: string[];
  /** Satu kalimat: kapan pemicunya berbunyi. */
  kapan: string;
  /** Yang cukup dibaca sekali (nama tabel yang menyesatkan, pasangannya di tempat lain). */
  catatan?: string;
}

/**
 * Asal-usul tiap baris tabel `template`: dari tabel Khanza mana pemicunya
 * dibaca, dan kapan ia berbunyi.
 *
 * Ada di sini, berdampingan dengan `TRIGGER_LABEL`, dan bukan di berkas
 * tersendiri: keduanya sama-sama keterangan STATIS berkunci kode pemicu, jadi
 * menaruhnya berjauhan berarti pemicu berikutnya punya dua tempat yang harus
 * diingat -- dan yang lupa diisi tidak menghasilkan satu pun galat, cuma baris
 * tabel yang diam-diam kehilangan keterangannya. `labels.test.ts` menjaga
 * daftar ini tetap MEMBAGI HABIS baris `template` yang benar-benar dimigrasikan.
 *
 * Sengaja HANYA memuat baris `template`. Pemicu lain (`FARMASI_*`, `BPJS_*`,
 * `ADMINISTRASI`, `SURAT_SAKIT`) punya halamannya sendiri berikut keterangannya
 * sendiri di sana; mencantumkannya di sini akan menjanjikan baris yang tidak
 * pernah muncul di halaman Template.
 */
export const TRIGGER_SOURCE: Record<string, TriggerSource> = {
  QUEUE_REG: {
    tabel: ['reg_periksa'],
    kapan: 'Begitu pendaftaran pasien disimpan dan nomor registrasinya terisi.',
  },
  BOOK_CONFIRM: {
    tabel: ['booking_registrasi'],
    kapan: 'Begitu booking baru terbaca, selama statusnya masih “Belum”.',
  },
  BOOK_CANCEL: {
    tabel: ['booking_registrasi'],
    kapan: 'Saat status booking berubah jadi “Batal” atau “Dokter Berhalangan”.',
    catatan:
      'Tabel dan pembacaan yang sama dengan Konfirmasi booking — yang membedakan keduanya hanya status barisnya, bukan sumbernya.',
  },
  BOOK_REMIND: {
    tabel: ['booking_registrasi'],
    kapan: 'Sehari sebelum tanggal periksa, pada jam yang disetel di Pengaturan.',
  },
  LAB_RESULT: {
    tabel: ['periksa_lab'],
    kapan: 'Saat hasil pemeriksaan laboratorium tersimpan.',
    catatan:
      'Satu pesan per kunjungan, bukan per item: panel darah lengkap menghasilkan belasan baris di Khanza dan tetap jadi satu pesan. Pasangan “Permintaan lab” dari ujung yang lain. Isinya bisa ikut dilampirkan sebagai berkas PDF — diatur di halaman Administrasi, tab “Hasil & tagihan”.',
  },
  RAD_RESULT: {
    tabel: ['periksa_radiologi'],
    kapan: 'Saat hasil pemeriksaan radiologi tersimpan.',
    catatan:
      'Dipisah dari Hasil lab supaya isi pesan, sakelar aktif, dan tujuan tambahannya bisa berbeda — grup Laboratorium dan grup Radiologi tidak perlu menerima hasil satu sama lain. Isinya bisa ikut dilampirkan sebagai berkas PDF — diatur di halaman Administrasi, tab “Hasil & tagihan”.',
  },
  LAB_REQUEST: {
    tabel: ['permintaan_lab'],
    kapan: 'Saat dokter memesan pemeriksaan laboratorium — bukan saat hasilnya keluar.',
    catatan: 'Pasangan “Hasil lab” dari ujung yang lain: yang ini memberi tahu ada pemeriksaan yang harus dijalani.',
  },
  RAD_REQUEST: {
    tabel: ['permintaan_radiologi'],
    kapan: 'Saat dokter memesan pemeriksaan radiologi — bukan saat hasilnya keluar.',
    catatan:
      'Dipisah dari Permintaan lab supaya tujuan tambahannya bisa berbeda: grup Laboratorium dan grup Radiologi tidak perlu menerima pekerjaan satu sama lain.',
  },
  PHARMACY_READY: {
    tabel: ['resep_obat'],
    kapan: 'Saat apotek mengisi tanggal penyerahan resep.',
  },
  BILLING_READY: {
    tabel: ['nota_jalan', 'nota_inap'],
    kapan: 'Saat nota rawat jalan atau rawat inap terbit.',
    catatan:
      'Rincian tagihannya bisa ikut dilampirkan sebagai berkas PDF — diatur di halaman Administrasi, tab “Hasil & tagihan”. Nama obat pada nota punya sakelarnya sendiri di sana.',
  },
  KONTROL_TERBIT: {
    tabel: ['skdp_bpjs'],
    kapan: 'Begitu surat kontrolnya disimpan di Khanza.',
    catatan:
      'Sumbernya menu “Surat Kontrol”. Akhiran _bpjs pada nama tabelnya peninggalan sejarah (SKDP) dan menyesatkan — isinya dipakai untuk pasien mana pun, termasuk non-BPJS. Surat kontrol lewat bridging VClaim tabelnya lain dan diurus di halaman BPJS, bukan di sini.',
  },
  KONTROL_ULANG: {
    tabel: ['skdp_bpjs'],
    kapan: 'Beberapa hari sebelum tanggal kontrol di surat; selisih hari dan jam kirimnya disetel di Pengaturan.',
    catatan:
      'Menu dan tabel yang sama dengan “Surat kontrol dibuat” — yang itu berbunyi saat suratnya disimpan, yang ini menjelang tanggal kontrolnya.',
  },
};

export function triggerSource(code: string): TriggerSource | undefined {
  return TRIGGER_SOURCE[code];
}

export const WA_STATUS_LABEL: Record<WaSessionStatus, string> = {
  disconnected: 'Terputus',
  qr_pending: 'Menunggu pindai QR',
  authenticating: 'Menghubungkan',
  ready: 'Tersambung',
  failed: 'Gagal masuk',
};

export const WA_STATUS_HELP: Record<WaSessionStatus, string> = {
  disconnected: 'Tidak ada sesi WhatsApp aktif. Tidak ada notifikasi yang bisa terkirim.',
  qr_pending: 'Menunggu QR dipindai dari ponsel bernomor notifikasi rumah sakit.',
  authenticating: 'Sesi sedang dipulihkan, biasanya beberapa detik.',
  ready: 'Sesi aktif dan siap mengirim.',
  failed: 'Autentikasi ditolak WhatsApp. Perlu pindai QR ulang.',
};

/**
 * `failed` sebelumnya tidak tertangani di halaman Koneksi (kodenya mencocokkan
 * `auth_failure`, nama EVENT whatsapp-web.js, sedangkan yang tersimpan di
 * `wa_session.status` adalah `failed`) -- akibatnya kegagalan autentikasi
 * tampil abu-abu netral, persis keadaan yang paling perlu terlihat merah.
 */
export function waStatusVariant(status: string): BadgeVariant {
  if (status === 'ready') return 'success';
  if (status === 'qr_pending' || status === 'authenticating') return 'warning';
  return 'danger';
}

/** Halaman Koneksi menerima status lewat JSON, jadi tipenya `string` di sana. */
export function waStatusLabel(status: string): string {
  return WA_STATUS_LABEL[status as WaSessionStatus] ?? status;
}

export function waStatusHelp(status: string): string | undefined {
  return WA_STATUS_HELP[status as WaSessionStatus];
}

export const SEND_OUTCOME_LABEL: Record<'sent' | 'error', string> = {
  sent: 'Terkirim',
  error: 'Gagal',
};
