/**
 * Aturan yang menentukan boleh-tidaknya sebuah perubahan akun.
 *
 * Sampai halaman Pengguna ada, semuanya cuma hidup di `scripts/manage-users.ts`
 * -- satu pagar, satu jalur, aman. Begitu dashboard menjadi jalur KEDUA ke tabel
 * yang sama, pagar yang tinggal di salah satu sisi adalah pagar yang cepat atau
 * lambat dilewati: yang menambah tombol di halaman tidak punya alasan membuka
 * skrip CLI untuk mencari tahu larangan apa yang pernah ditulis di sana.
 *
 * Fungsi murni (tanpa database) supaya bisa diuji tanpa menyiapkan keadaan yang
 * justru paling sulit dibuat: "satu-satunya admin aktif yang tersisa". Membuat
 * keadaan itu di database berarti menonaktifkan admin sungguhan lebih dulu, dan
 * kalau ujinya gagal di tengah, yang tertinggal adalah sistem tanpa admin.
 */

export type AppUserRole = 'admin' | 'operator';

export const PANJANG_SANDI_MINIMAL = 8;
export const PANJANG_USERNAME_MINIMAL = 3;
export const PANJANG_USERNAME_MAKSIMAL = 50;
export const PANJANG_NAMA_MAKSIMAL = 80;

/**
 * Keadaan yang diperlukan untuk memutuskan, dikumpulkan pemanggil dari
 * database. Sengaja bukan objek model Sequelize: keputusannya tidak boleh
 * bergantung pada apa pun yang hanya ada saat database hidup.
 */
export interface KeadaanPerubahan {
  /** Peran sasaran SEBELUM perubahan. */
  peranSekarang: AppUserRole;
  /** Aktif-tidaknya sasaran SEBELUM perubahan. */
  aktifSekarang: boolean;
  /** Jumlah admin yang aktif saat ini, TERMASUK sasaran bila ia memenuhi syarat. */
  adminAktif: number;
  /** Benar bila sasaran adalah akun pelaku sendiri. */
  diriSendiri: boolean;
}

/** null = boleh. String = alasan penolakan, sudah berupa kalimat untuk staf. */
export type Penolakan = string | null;

const PESAN_ADMIN_TERAKHIR =
  'Ini satu-satunya admin yang masih aktif. Menonaktifkan, menurunkan peran, atau menghapusnya akan mengunci semua orang keluar dari halaman pengaturan, template, broadcast, dan audit -- dan satu-satunya jalan kembali adalah menyunting database langsung. Buat atau aktifkan admin lain dulu.';

/** Sasaran ikut dihitung sebagai admin aktif hanya bila ia memang admin DAN aktif. */
function sasaranAdalahAdminAktif(keadaan: KeadaanPerubahan): boolean {
  return keadaan.peranSekarang === 'admin' && keadaan.aktifSekarang;
}

export function bolehNonaktifkan(keadaan: KeadaanPerubahan): Penolakan {
  if (!keadaan.aktifSekarang) return null; // sudah nonaktif, bukan perubahan
  if (sasaranAdalahAdminAktif(keadaan) && keadaan.adminAktif <= 1) return PESAN_ADMIN_TERAKHIR;
  // Menonaktifkan diri sendiri tidak mengunci siapa pun (masih ada admin lain),
  // tapi hampir pasti bukan yang dimaksud: pelakunya tetap bisa memakai
  // dashboard sampai sesinya habis, lalu tiba-tiba tidak bisa masuk lagi tanpa
  // ada yang menjelaskan kenapa.
  if (keadaan.diriSendiri) return 'Tidak bisa menonaktifkan akun sendiri. Minta admin lain melakukannya.';
  return null;
}

/**
 * Menurunkan peran admin terakhir sama merusaknya dengan menonaktifkannya, dan
 * ini yang paling gampang lolos: tabel akun tetap menampilkan satu baris
 * "aktif" sesudahnya, jadi tidak ada yang terlihat hilang.
 */
export function bolehUbahPeran(keadaan: KeadaanPerubahan, peranBaru: AppUserRole): Penolakan {
  if (peranBaru === keadaan.peranSekarang) return null;
  if (peranBaru === 'admin') return null; // menaikkan peran tidak pernah mengunci siapa pun
  if (sasaranAdalahAdminAktif(keadaan) && keadaan.adminAktif <= 1) return PESAN_ADMIN_TERAKHIR;
  if (keadaan.diriSendiri) {
    return 'Tidak bisa menurunkan peran akun sendiri. Minta admin lain melakukannya.';
  }
  return null;
}

/**
 * Menghapus permanen. Pagarnya SAMA dengan menonaktifkan, dan itu disengaja --
 * keduanya berujung pada orang yang sama tidak bisa masuk lagi, jadi keadaan
 * yang berbahaya untuk yang satu berbahaya juga untuk yang lain.
 *
 * Yang BERBEDA: tidak ada pengecualian "sudah nonaktif, bukan perubahan".
 * Menonaktifkan akun yang sudah nonaktif memang tidak mengubah apa pun,
 * sedangkan menghapusnya tetap menghilangkan barisnya untuk selamanya.
 *
 * Yang TIDAK dijaga di sini, karena tidak bisa: `audit_log.actor` menyimpan
 * username sebagai teks, bukan foreign key, jadi riwayat lama TETAP utuh
 * sesudah barisnya hilang. Efek sampingnya justru kebalikannya -- usernamenya
 * jadi bisa dipakai lagi oleh orang lain, dan sejak saat itu riwayat lama
 * terbaca seolah milik orang baru itu. Yang menutup celahnya bukan pagar
 * melainkan pencatatan: penghapusannya sendiri masuk `audit_log` berikut
 * username dan perannya, sehingga batas antara dua pemakai nama yang sama
 * tetap bisa ditemukan.
 */
export function bolehHapus(keadaan: KeadaanPerubahan): Penolakan {
  if (sasaranAdalahAdminAktif(keadaan) && keadaan.adminAktif <= 1) return PESAN_ADMIN_TERAKHIR;
  // Lebih keras daripada menonaktifkan diri sendiri: di sana pelakunya masih
  // bisa diaktifkan lagi oleh admin lain, di sini akunnya sudah tidak ada.
  if (keadaan.diriSendiri) return 'Tidak bisa menghapus akun sendiri. Minta admin lain melakukannya.';
  return null;
}

export function periksaSandi(sandi: string): Penolakan {
  if (sandi.length < PANJANG_SANDI_MINIMAL) {
    return `Kata sandi minimal ${PANJANG_SANDI_MINIMAL} karakter.`;
  }
  // Sengaja TIDAK memaksa kombinasi huruf besar/angka/simbol. Aturan semacam
  // itu menghasilkan sandi pendek yang ditempel di monitor, bukan sandi yang
  // lebih kuat -- dan komputer loket dipakai bergantian banyak orang.
  return null;
}

/**
 * Username dipakai sebagai `actor` di `audit_log` dan tidak pernah bisa diubah
 * setelah dibuat -- mengubahnya akan memutus jejak audit lama dari pemiliknya.
 * Karena itu bentuknya dibatasi di depan, bukan dibiarkan lalu disesalkan.
 */
export function periksaUsername(username: string): Penolakan {
  const u = username.trim();
  if (u.length < PANJANG_USERNAME_MINIMAL) return `Nama pengguna minimal ${PANJANG_USERNAME_MINIMAL} karakter.`;
  if (u.length > PANJANG_USERNAME_MAKSIMAL) return `Nama pengguna maksimal ${PANJANG_USERNAME_MAKSIMAL} karakter.`;
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return 'Nama pengguna hanya boleh huruf kecil, angka, titik, garis bawah, dan strip -- tanpa spasi.';
  }
  return null;
}

export function periksaNama(nama: string): Penolakan {
  const n = nama.trim();
  if (n.length === 0) return 'Nama lengkap wajib diisi.';
  if (n.length > PANJANG_NAMA_MAKSIMAL) return `Nama lengkap maksimal ${PANJANG_NAMA_MAKSIMAL} karakter.`;
  return null;
}

export const PERAN_LABEL: Record<AppUserRole, string> = {
  admin: 'Admin',
  operator: 'Operator',
};

export const PERAN_KETERANGAN: Record<AppUserRole, string> = {
  admin: 'Bisa membuka semua halaman, termasuk pengaturan, broadcast, audit, dan pengelolaan pengguna.',
  operator: 'Bisa memantau antrean, log, nomor bermasalah, dan template. Tidak bisa mengubah pengaturan atau mengirim broadcast.',
};
