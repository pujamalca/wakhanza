/**
 * JADWAL REKAP HARIAN -- matematika jam dan tanggal yang dipakai BERSAMA oleh
 * setiap rekap harian, apa pun isinya. Fungsi murni, tanpa database.
 *
 * ==========================================================================
 * Kenapa dipisah ke berkas sendiri
 * ==========================================================================
 *
 * Ketiganya lahir di `core/penjualanRekap.ts` waktu rekap harian cuma ada satu.
 * Begitu rekap KEDUA (resep, migrations/042) datang, ada dua pilihan: menyalinnya,
 * atau mengangkatnya ke sini.
 *
 * Menyalinnya adalah bentuk kegagalan yang sudah berkali-kali dibayar di proyek
 * ini (`respectsOptOut()`, `core/outboxStatus.ts`, `kunciPesanMasuk()`,
 * `core/tujuanPemicu.ts`, `core/tujuanPemicu.ts`): beberapa tempat berjauhan
 * menafsirkan sendiri satu hal yang sama, dan cukup SATU yang berbeda untuk
 * membuat satu jalur diam-diam berperilaku lain. Di sini bentuk penyimpangannya
 * bisa dibayangkan persis -- dua salinan `hariRekap()` yang berbeda satu baris
 * dalam menangani pergantian bulan menghasilkan DUA REKAP yang tidak sepakat
 * tanggal berapa "kemarin", dikirim ke grup yang sama, pada malam yang sama.
 * Tanpa satu pun galat.
 *
 * Membiarkannya di `penjualanRekap.ts` lalu mengimpornya dari modul resep juga
 * salah, dan bukan cuma soal nama: berkas itu berisi `gabungRekap()` yang penuh
 * pengetahuan tentang `jns_jual` dan rupiah, jadi setiap penyunting berikutnya
 * yang membuka `resepRekap.ts` akan menemukan impor dari sebuah modul penjualan
 * dan wajar menyimpulkan ada keterkaitan yang sebenarnya tidak ada.
 *
 * `penjualanRekap.ts` ME-RE-EXPORT ketiganya, jadi tidak satu pun impor yang
 * sudah ada berubah dan fitur yang sedang berjalan di produksi tidak tersentuh.
 *
 * ==========================================================================
 * Yang SENGAJA tidak ikut pindah: jam bawaan
 * ==========================================================================
 *
 * `JAM_REKAP_BAWAAN` (21:00 penjualan) dan `JAM_REKAP_RESEP_BAWAAN` (22:00)
 * tetap tinggal di modul fiturnya masing-masing. Keduanya BUKAN kesepakatan
 * bersama melainkan hasil pengukuran yang berbeda -- penjualan berhenti pukul
 * 20:00 dengan jam 21 benar-benar nol, sementara peresepan punya ekor tipis
 * sampai 23:11. Menyatukannya jadi satu konstanta berarti satu pengukuran
 * diam-diam dipakai untuk membenarkan yang lain, dan angka yang kehilangan
 * asal-usulnya adalah angka yang tidak bisa dipertanggungjawabkan saat
 * dipertanyakan.
 */

export interface JamRekap {
  jam: number;
  menit: number;
}

/**
 * Baca "HH:MM" dari pengaturan.
 *
 * Mengembalikan `null` untuk apa pun yang tidak berbentuk jam yang sah, dan
 * PEMANGGIL yang memutuskan artinya -- dua kelas pemanggilnya memang harus
 * berbeda:
 *
 * - Server action saat MENYIMPAN menolaknya di depan orang yang bisa
 *   memperbaikinya seketika.
 * - Worker, yang berjalan tengah malam tanpa siapa-siapa untuk diberi tahu,
 *   jatuh ke jam bawaan fiturnya dan mencatat `warn`. Menolak diam berarti
 *   rekapnya berhenti selamanya tanpa satu pun tanda -- kegagalan senyap yang
 *   sama jenisnya dengan sakelar menyala tanpa tujuan tercentang.
 *
 * Bentuk `H:M` (satu digit) diterima; `24:00` tidak, karena tidak ada waktu
 * seperti itu dalam sehari dan menerimanya berarti jadwal yang tidak pernah
 * jatuh tempo.
 */
export function bacaJamRekap(raw: string | null | undefined): JamRekap | null {
  if (!raw) return null;
  const cocok = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(raw);
  if (!cocok) return null;
  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (!Number.isInteger(jam) || !Number.isInteger(menit)) return null;
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return { jam, menit };
}

/** Bentuk normal untuk disimpan kembali ke pengaturan. */
export function tulisJamRekap(j: JamRekap): string {
  return `${String(j.jam).padStart(2, '0')}:${String(j.menit).padStart(2, '0')}`;
}

/**
 * Tanggal yang direkap, dihitung mundur dari hari saat rekapnya dikirim.
 *
 * `setDate` dipakai apa adanya (bukan aritmetika milidetik) supaya pergantian
 * bulan, tahun, dan tahun kabisat ditangani Node, bukan oleh kita -- pola yang
 * sama dengan `sasaranKontrol()` di `core/bpjs.ts`.
 *
 * Offset negatif dianggap 0: "merekap hari besok" tidak punya arti, dan
 * membiarkannya lewat berarti rekap yang selamanya kosong.
 */
export function hariRekap(sekarang: Date, offsetHari: number): string {
  const n = Number.isFinite(offsetHari) ? Math.max(0, Math.floor(offsetHari)) : 0;
  const d = new Date(sekarang);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ==========================================================================
 * BANYAK JAM DALAM SEHARI -- dan kenapa penanda bertanggal tidak cukup
 * ==========================================================================
 *
 * Ketiga rekap yang sudah ada (penjualan, resep, darurat stok) berbunyi TEPAT
 * SEKALI sehari, jadi penandanya cukup menyimpan TANGGAL dan `jatuhTempoHarian()`
 * di `core/bpjs.ts` membandingkannya dengan hari ini.
 *
 * Bentuk itu RUSAK begitu ada dua jam. Rekap pukul 13:00 menulis "2026-08-13"
 * ke penandanya, lalu pukul 19:30 penanda itu masih berbunyi "hari ini" --
 * sehingga kiriman kedua tidak pernah berangkat. Tanpa satu pun galat, dan yang
 * terlihat cuma satu rekap sehari pada sistem yang setelannya jelas menyebut dua.
 *
 * Karena itu penandanya menyimpan TANGGAL BERIKUT SLOTNYA ("2026-08-13 19:30"),
 * dan kejatuhtempoan dihitung terhadap slot -- bukan terhadap hari.
 *
 * `jatuhTempoHarian()` sengaja TIDAK diubah. Ia dipakai tiga fitur yang sedang
 * berjalan di produksi, dan melebarkannya berarti mengubah perilaku ketiganya
 * sebagai efek samping penambahan fitur yang tidak meminta itu -- persis kejutan
 * yang sudah dihindari saat rekap penjualan menolak menyentuh jam tenang keempat
 * pemicu nota barang (migrations/041).
 */

/**
 * Baca daftar jam dari satu kunci pengaturan: `"13:00,19:30"`.
 *
 * Dipisah koma karena itu bentuk yang sudah dipakai kunci berdaftar lain di
 * `app_setting` (`privacy.sensitive_poli_codes`, `farmasi.stok_keywords`), jadi
 * staf yang pernah menyunting salah satunya tidak perlu belajar bentuk kedua.
 *
 * Potongan yang tidak sah DIBUANG, bukan menggugurkan seluruh daftarnya: satu
 * salah ketik di antara tiga jam tidak boleh mematikan ketiganya sekaligus.
 * Pemanggil yang perlu tahu ada yang dibuang membandingkan `length`-nya sendiri
 * -- server action MENOLAK simpan (ada orang di depan layar), worker meneruskan
 * dengan sisanya (pukul sembilan malam tidak ada siapa-siapa untuk diberi tahu).
 *
 * Hasilnya TERURUT NAIK dan UNIK. Keduanya syarat, bukan kerapian:
 * `slotJatuhTempo()` mengambil kandidat TERAKHIR sebagai yang paling akhir lewat,
 * dan daftar yang tidak terurut membuatnya mengambil yang keliru. Duplikat
 * ("13:00,13:00") akan membuat slot yang sama dinilai dua kali.
 */
export function bacaSlotRekap(raw: string | null | undefined): JamRekap[] {
  if (!raw) return [];
  const terlihat = new Set<string>();
  const hasil: JamRekap[] = [];
  for (const potong of raw.split(',')) {
    const j = bacaJamRekap(potong);
    if (!j) continue;
    const kunci = tulisJamRekap(j);
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);
    hasil.push(j);
  }
  return hasil.sort((a, b) => menitSlot(a) - menitSlot(b));
}

/** Bentuk normal untuk disimpan kembali: `"13:00,19:30"`. */
export function tulisSlotRekap(slots: JamRekap[]): string {
  return slots.map(tulisJamRekap).join(',');
}

/** Menit sejak tengah malam. Satu penurunan, dipakai pengurut dan pembanding. */
function menitSlot(j: JamRekap): number {
  return j.jam * 60 + j.menit;
}

/** Penanda yang disimpan ke `app_setting`: `"2026-08-13 19:30"`. */
export function tulisPenandaSlot(tanggal: string, slot: JamRekap): string {
  return `${tanggal} ${tulisJamRekap(slot)}`;
}

/**
 * Slot mana yang jatuh tempo SEKARANG, atau `null` bila tidak ada.
 *
 * ==========================================================================
 * Hanya slot TERAKHIR yang berbunyi, slot terlewat TIDAK dikejar
 * ==========================================================================
 *
 * Kalau worker mati dari pukul 12:00 sampai 20:00, dua slot (13:00 dan 19:30)
 * sama-sama sudah lewat. Yang dikirim tetap SATU.
 *
 * Sebabnya bukan penghematan melainkan ISI PESANNYA: rekap ini dihitung pada
 * saat KIRIM, bukan pada saat slotnya jatuh -- ia membaca keadaan asesmen saat
 * itu juga. Jadi mengirim keduanya menghasilkan dua pesan yang isinya nyaris
 * sama persis, berjarak beberapa detik, ke grup yang sama. Itu bukan riwayat
 * yang tertebus, itu kebisingan -- dan pesan yang berulang tanpa menambah
 * informasi adalah persis yang membuat penerimanya berhenti membaca (pelajaran
 * `farmasi.template_darurat_kosong`).
 *
 * ==========================================================================
 * Perbandingannya `>`, bukan `!==` -- dan bedanya menggigit saat jam DIHAPUS
 * ==========================================================================
 *
 * Bentuk yang lebih jelas ("penandanya bukan slot ini, berarti belum dikirim")
 * salah pada satu urutan tindakan yang sepenuhnya wajar: staf menghapus jam
 * 19:30 sesudah ia berbunyi, menyisakan 13:00. Pukul 20:00, kandidat terakhir
 * jadi 13:00 lagi, dan `penanda !== '13:00'` bernilai benar -- sehingga rekap
 * yang sudah dikirim tujuh jam lalu berangkat sekali lagi.
 *
 * Dengan `>`, slot hanya berbunyi bila ia LEBIH AKHIR daripada yang terakhir
 * tercatat hari itu, jadi menghapus jam tidak pernah membangkitkan kiriman lama.
 */
export function slotJatuhTempo(
  sekarang: Date,
  slots: JamRekap[],
  penandaTerakhir: string | null | undefined,
): JamRekap | null {
  if (slots.length === 0) return null;

  const menitSekarang = sekarang.getHours() * 60 + sekarang.getMinutes();
  // `slots` dijamin terurut naik oleh bacaSlotRekap(), jadi yang terakhir lolos
  // penyaring inilah slot paling akhir yang waktunya sudah lewat.
  const lewat = slots.filter((s) => menitSlot(s) <= menitSekarang);
  const terakhir = lewat.at(-1);
  if (!terakhir) return null;

  if (!penandaTerakhir) return terakhir;

  const [tanggalPenanda, jamPenanda] = penandaTerakhir.trim().split(/\s+/);
  const hariIni = hariRekap(sekarang, 0);
  // Penanda dari hari lain -- termasuk penanda bentuk LAMA yang cuma berisi
  // tanggal -- tidak menahan apa pun hari ini.
  if (tanggalPenanda !== hariIni) return terakhir;

  const slotPenanda = bacaJamRekap(jamPenanda);
  // Penanda hari ini tanpa slot yang bisa dibaca: satu-satunya yang tersisa
  // adalah gagal AMAN. Menganggapnya "belum pernah" akan mengirim ulang rekap
  // yang mungkin sudah berangkat, dan pada isi berupa daftar pasien itu jauh
  // lebih mahal daripada satu rekap yang terlewat.
  if (!slotPenanda) return null;

  return menitSlot(terakhir) > menitSlot(slotPenanda) ? terakhir : null;
}
