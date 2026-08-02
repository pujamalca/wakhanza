/**
 * Aturan lampiran gambar/dokumen untuk BROADCAST.
 *
 * Seluruhnya fungsi murni (tanpa berkas, tanpa database) supaya validasi yang
 * dipakai server action saat menyimpan PERSIS sama dengan yang dipakai layar
 * saat staf memilih berkas -- pesan penolakan yang baru muncul setelah tombol
 * Kirim ditekan adalah cara termahal untuk memberi tahu bahwa berkasnya terlalu
 * besar.
 *
 * Lingkupnya SENGAJA hanya /broadcast manual: di sana selalu ada staf yang
 * melihat lampirannya sebelum menekan Kirim. Broadcast terjadwal, tujuh pemicu
 * otomatis, dan balasan otomatis tetap teks -- ketiganya mengirim tanpa ada
 * manusia yang meninjau tiap kali.
 */

export interface JenisLampiran {
  mime: string;
  ext: string;
  label: string;
  /** WhatsApp memperlakukan gambar berbeda dari dokumen: gambar tampil langsung dengan keterangan. */
  gambar: boolean;
}

/**
 * Daftar-IZIN, bukan daftar-tolak. Berkas yang tidak dikenal ditolak alih-alih
 * diteruskan apa adanya ke WhatsApp -- nomor rumah sakit tidak boleh jadi
 * saluran pengiriman berkas sembarang jenis.
 */
export const JENIS_LAMPIRAN: JenisLampiran[] = [
  { mime: 'image/jpeg', ext: 'jpg', label: 'Gambar JPG', gambar: true },
  { mime: 'image/png', ext: 'png', label: 'Gambar PNG', gambar: true },
  { mime: 'image/webp', ext: 'webp', label: 'Gambar WebP', gambar: true },
  { mime: 'application/pdf', ext: 'pdf', label: 'Dokumen PDF', gambar: false },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    label: 'Dokumen Word',
    gambar: false,
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    label: 'Dokumen Excel',
    gambar: false,
  },
];

/** Untuk atribut `accept` pada input berkas. */
export const ACCEPT_LAMPIRAN = JENIS_LAMPIRAN.map((j) => j.mime).join(',');

export function jenisLampiranDari(mime: string): JenisLampiran | null {
  return JENIS_LAMPIRAN.find((j) => j.mime === mime.toLowerCase().trim()) ?? null;
}

/** Batas bawaan; bisa diturunkan lewat app_setting `broadcast.max_media_mb`. */
export const MAX_LAMPIRAN_MB = 16;

/**
 * Batas panjang KETERANGAN gambar/dokumen di WhatsApp.
 *
 * Ini jebakan yang tidak terlihat sampai pesan pertama gagal terkirim: pesan
 * teks biasa boleh panjang, tapi begitu ada lampiran, isi pesan menjadi
 * *keterangan* lampiran dan tunduk pada batas yang jauh lebih pendek. Staf yang
 * menyusun pengumuman panjang lalu menambahkan poster di akhir tidak punya cara
 * menduga ini -- karena itu diperiksa saat menyusun, bukan saat mengirim.
 */
export const MAX_KETERANGAN = 1024;

export interface HasilPeriksaLampiran {
  ok: boolean;
  error?: string;
}

export function periksaBerkasLampiran(
  namaBerkas: string,
  mime: string,
  ukuranByte: number,
  maxMb = MAX_LAMPIRAN_MB,
): HasilPeriksaLampiran {
  if (!namaBerkas.trim()) return { ok: false, error: 'Berkas tidak punya nama.' };

  const jenis = jenisLampiranDari(mime);
  if (!jenis) {
    return {
      ok: false,
      error: `Jenis berkas tidak didukung. Yang bisa dilampirkan: ${JENIS_LAMPIRAN.map((j) => j.ext.toUpperCase()).join(', ')}.`,
    };
  }

  if (ukuranByte <= 0) return { ok: false, error: 'Berkas kosong.' };

  const maxByte = maxMb * 1024 * 1024;
  if (ukuranByte > maxByte) {
    return { ok: false, error: `Berkas ${formatUkuran(ukuranByte)}, melebihi batas ${maxMb} MB.` };
  }

  return { ok: true };
}

/**
 * Panjang pesan diperiksa TERHADAP BATAS KETERANGAN hanya ketika ada lampiran.
 * Tanpa lampiran, pesan panjang sama sekali tidak masalah -- jadi memberlakukan
 * batas yang sama untuk keduanya hanya akan menolak pengumuman yang sah.
 */
export function periksaPanjangKeterangan(body: string, panjangFooter: number): HasilPeriksaLampiran {
  const total = body.length + panjangFooter;
  if (total > MAX_KETERANGAN) {
    return {
      ok: false,
      error: `Pesan berlampiran dibatasi ${MAX_KETERANGAN} karakter oleh WhatsApp (sekarang ${total}, termasuk ${panjangFooter} karakter baris kode pengiriman). Persingkat pesannya, atau kirim tanpa lampiran.`,
    };
  }
  return { ok: true };
}

export function formatUkuran(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(0)} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Nama berkas yang disimpan TIDAK PERNAH diturunkan dari nama yang diunggah.
 *
 * Nama unggahan adalah masukan dari luar: "../../.env" atau "poster.pdf.exe"
 * keduanya nama yang sah bagi peramban. Ekstensi diambil dari jenis MIME yang
 * sudah lolos daftar-izin di atas, dan sisa namanya dibuat sendiri -- jadi
 * tidak ada jalur di mana isi kolom nama bisa menentukan lokasi tulis.
 */
export function namaBerkasSimpanan(mime: string, acak: string): string | null {
  const jenis = jenisLampiranDari(mime);
  if (!jenis) return null;
  if (!/^[a-z0-9]+$/i.test(acak)) return null;
  return `${acak}.${jenis.ext}`;
}
