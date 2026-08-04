/**
 * Penggantian variabel `{nama}` — satu lintasan, wajib (ARCHITECTURE §9.2).
 *
 * `nm_pasien`/`nm_poli`/`nm_dokter` di sik diisi manusia tanpa batasan format
 * (N9). Pasien bernama literal "{kontak_rs}" tidak boleh membuat nomor telepon
 * rumah sakit muncul di posisi namanya — itu sebabnya String.replace dengan
 * callback (satu pemindaian kiri-ke-kanan) dipakai, BUKAN perulangan sampai
 * tidak ada lagi `{...}` yang cocok. Hasil substitusi tidak pernah diperiksa
 * ulang untuk pola `{...}`.
 */
const VAR_RE = /\{(\w+)\}/g;

/**
 * Variabel untuk ketujuh template pemicu (`template`, satu baris per
 * trigger_code). Semuanya mengacu ke SATU kunjungan yang sedang terjadi.
 */
export const TRIGGER_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'no_antrian',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jenis_layanan',
] as const;

/**
 * BROADCAST tidak terikat satu kunjungan -- {no_antrian}/{nama_poli}/
 * {nama_dokter}/{tanggal}/{jam}/{jenis_layanan} mengacu ke SATU kejadian
 * spesifik yang tidak well-defined untuk segmen pasien merentang banyak
 * kunjungan. Subset ini sengaja lebih sempit dari TRIGGER_TEMPLATE_VARIABLES.
 */
export const BROADCAST_TEMPLATE_VARIABLES = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;

/**
 * BALASAN OTOMATIS berjalan ke arah sebaliknya: dipicu pesan MASUK dari nomor
 * yang belum tentu dikenali sebagai pasien mana pun, jadi {nama_pasien}/{no_rm}
 * sengaja TIDAK tersedia -- membalas dengan nama pasien ke nomor yang cuma
 * "nomor yang mengirim WhatsApp" berarti menerka identitas, dan nomor bisa
 * berpindah tangan.
 *
 * Sebagai gantinya ada tiga variabel yang isinya dibaca langsung dari sik saat
 * membalas (bukan dari kunjungan): {jadwal_dokter}, {jadwal_hari_ini},
 * {daftar_poli}. Ketiganya informasi layanan yang memang diumumkan RS, bukan
 * data satu pasien -- lihat khanza/jadwalDokter.ts.
 */
export const AUTOREPLY_TEMPLATE_VARIABLES = [
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'tanggal',
  'jam',
  'jadwal_dokter',
  'jadwal_hari_ini',
  'daftar_poli',
] as const;

/**
 * NOTIFIKASI FARMASI -- satu-satunya konteks yang penerimanya STAF, dan itu
 * membalik pertimbangannya.
 *
 * Tiga daftar di atas membatasi variabel demi PASIEN yang membacanya. Di sini
 * pembatasnya justru sebaliknya: yang dilindungi adalah pasien yang TIDAK
 * membaca pesan ini, karena isinya dibaca sekian orang di sebuah grup WhatsApp.
 *
 * {no_resep} ada karena itulah yang membuat pesannya berguna: satu nomor yang
 * bisa dibuka di SIMRS. Yang sengaja TIDAK ada dan jangan ditambahkan: nama
 * obat, jumlah, aturan pakai, dan diagnosis -- src/khanza/farmasiStaf.ts memang
 * tidak pernah mengambilnya dari `sik`, dan menambahkan variabelnya di sini
 * akan jadi alasan pertama untuk mulai mengambilnya.
 *
 * {jumlah_resep} hanya terisi pada pesan REKAP (lihat farmasi.max_per_cycle);
 * pada pesan satuan ia dirender jadi string kosong seperti variabel lain yang
 * tidak diisi.
 */
export const FARMASI_TEMPLATE_VARIABLES = [
  'no_resep',
  'nama_pasien',
  'no_rm',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jumlah_resep',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * BALASAN STOK OBAT (`/farmasi`) -- dijawab atas pertanyaan yang masuk, jadi
 * daftarnya sengaja BERBEDA dari FARMASI_TEMPLATE_VARIABLES di atas.
 *
 * Yang TIDAK ada di sini, dan ketiadaannya disengaja: `{nama_pasien}`,
 * `{no_rm}`, `{no_resep}`. Pemicunya adalah sebuah NOMOR yang mengirim
 * WhatsApp, yang belum tentu pasien terdaftar mana pun -- alasan yang sama
 * persis membuat AUTOREPLY_TEMPLATE_VARIABLES juga tidak punya keduanya.
 * Menyediakannya di sini akan jadi undangan untuk mulai mencari pasien dari
 * nomor pengirim, dan sejak itu jawaban katalog berubah menjadi data pasien.
 *
 * `{cari_obat}` adalah teks yang DIKETIK penanya, dikembalikan apa adanya
 * supaya pesan "tidak ditemukan" bisa menyebut apa yang dicari.
 */
export const STOK_TEMPLATE_VARIABLES = [
  'stok_obat',
  'cari_obat',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * DARURAT STOK (`/farmasi`) -- peringatan persediaan yang dikirim TANPA ada
 * yang bertanya, jadi ia lagi-lagi berbeda dari dua daftar farmasi di atas.
 *
 * Yang TIDAK ada, dan ketiadaannya adalah pagarnya: `{nama_pasien}`, `{no_rm}`,
 * `{no_resep}`. Peringatan persediaan gudang tidak berurusan dengan seorang
 * pasien pun; menyediakan variabelnya akan jadi alasan pertama untuk mulai
 * menggabungkan katalog dengan `resep_obat`, dan penggabungan itulah yang
 * mengubah daftar barang menjadi rekam medis (lihat khanza/stokObat.ts).
 *
 * `{daftar_stok}` berbentuk banyak baris dan karena itu masuk
 * MULTILINE_VARIABLES di bawah -- aman HANYA karena core/stokDarurat.ts
 * memanggil sanitizeValue() sendiri untuk tiap nama barang dan satuan.
 */
export const DARURAT_TEMPLATE_VARIABLES = [
  'daftar_stok',
  'jumlah_habis',
  'jumlah_menipis',
  'jumlah_total',
  'nama_jenis',
  'tanggal',
  'jam',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
] as const;

/**
 * Gabungan seluruh konteks -- INI yang dimengerti `renderTemplate`, bukan
 * daftar yang boleh dipakai di satu tempat tertentu. Pembatasan per konteks
 * terjadi saat template DISIMPAN lewat findUnknownVariables(body, <daftar>),
 * jadi satu renderer tetap melayani semua konteks tanpa cabang.
 */
export const KNOWN_TEMPLATE_VARIABLES = [
  ...new Set([
    ...TRIGGER_TEMPLATE_VARIABLES,
    ...BROADCAST_TEMPLATE_VARIABLES,
    ...AUTOREPLY_TEMPLATE_VARIABLES,
    ...FARMASI_TEMPLATE_VARIABLES,
    ...STOK_TEMPLATE_VARIABLES,
    ...DARURAT_TEMPLATE_VARIABLES,
  ]),
] as const;

export type TemplateVariable =
  | (typeof TRIGGER_TEMPLATE_VARIABLES)[number]
  | (typeof BROADCAST_TEMPLATE_VARIABLES)[number]
  | (typeof AUTOREPLY_TEMPLATE_VARIABLES)[number]
  | (typeof FARMASI_TEMPLATE_VARIABLES)[number]
  | (typeof STOK_TEMPLATE_VARIABLES)[number]
  | (typeof DARURAT_TEMPLATE_VARIABLES)[number];

export function extractVariables(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(VAR_RE)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

/** Dipanggil saat template DISIMPAN, bukan saat dikirim (ARCHITECTURE §5.3). */
export function findUnknownVariables(body: string, allowed: readonly string[] = TRIGGER_TEMPLATE_VARIABLES): string[] {
  const known = new Set<string>(allowed);
  return extractVariables(body).filter((v) => !known.has(v));
}

/**
 * Buang karakter kendali dan baris baru, rapikan spasi berlebih, batasi
 * panjang. Nama 40 karakter berisi baris baru bisa dipakai memalsukan
 * struktur pesan supaya tampak seperti pengumuman resmi RS (§9.2).
 */
export function sanitizeValue(value: string, maxLength = 60): string {
  const cleaned = value.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxLength);
}

/**
 * Variabel yang isinya SUDAH dirangkai oleh kode kita sendiri dari beberapa
 * kolom terstruktur, berbentuk banyak baris, dan karena itu dikecualikan dari
 * sanitizeValue -- yang justru bertugas membuang baris baru dan memotong di 60
 * karakter.
 *
 * Pengecualian ini aman HANYA karena perangkainya (khanza/jadwalDokter.ts)
 * memanggil sanitizeValue sendiri untuk tiap nama dokter/poli sebelum
 * menyusunnya jadi daftar. Jangan pernah menambahkan variabel ke sini yang
 * isinya datang langsung dari satu kolom sik tanpa melewati sanitizeValue --
 * itu persis lubang §9.2 yang sanitizeValue ada untuk menutupnya.
 *
 * Aturan satu lintasan tetap utuh: String.replace dengan callback memindai
 * string ASLI sekali kiri-ke-kanan dan tidak pernah memeriksa ulang hasil
 * substitusi, jadi `{kontak_rs}` yang kebetulan ada di dalam daftar jadwal
 * tetap tampil apa adanya.
 */
const MULTILINE_VARIABLES = new Set<string>([
  'jadwal_dokter',
  'jadwal_hari_ini',
  'daftar_poli',
  'stok_obat',
  'daftar_stok',
]);

export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string>>): string {
  return body.replace(VAR_RE, (_match, key: string) => {
    const value = vars[key as TemplateVariable];
    if (value === undefined) return '';
    return MULTILINE_VARIABLES.has(key) ? value : sanitizeValue(value);
  });
}
