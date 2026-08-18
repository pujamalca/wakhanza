/**
 * Penyusun ISI dokumen hasil lab, hasil radiologi, dan nota tagihan --
 * seluruhnya fungsi murni (migrations/038).
 *
 * Pola yang sama persis dengan `core/suratDoc.ts`, dan alasannya juga sama:
 * pratinjau di layar dan berkas PDF yang benar-benar terkirim WAJIB berangkat
 * dari penurunan yang sama. Yang berbeda kalau menyimpang bukan tampilan
 * melainkan ANGKA yang dibaca pasien -- dan angka nota yang berbeda antara
 * layar staf dan berkas pasien adalah telepon ke kasir, bukan sekadar kerapian.
 *
 * Perkakas bersamanya (`isianSurat`, `rakitAlamat`, `formatTanggalSurat`, ...)
 * DIIMPOR dari `core/suratDoc.ts` alih-alih disalin. Daftar penanda kosong
 * Khanza di sana tumbuh dari pengamatan atas data sungguhan; salinan kedua yang
 * tidak ikut diperbarui saat penanda berikutnya ditemukan adalah salinan yang
 * diam-diam salah. Aman karena modul itu tidak mengimpor apa pun.
 */

import {
  type BarisIsian,
  type KopSurat,
  isianSurat,
  rakitAlamat,
  formatTanggalSurat,
  formatTanggalRingkas,
  formatUmurSurat,
  jenisKelaminLengkap,
} from './suratDoc';
import { formatRupiah, formatJumlah } from './notaBarang';

export type JenisDokumen = 'lab' | 'radiologi' | 'nota';

export const JUDUL_DOKUMEN: Record<JenisDokumen, string> = {
  lab: 'HASIL PEMERIKSAAN LABORATORIUM',
  radiologi: 'HASIL PEMERIKSAAN RADIOLOGI',
  nota: 'RINCIAN TAGIHAN',
};

/**
 * Pesan pengantar bawaan, dipakai saat barisnya di `app_setting` kosong.
 *
 * Tinggal di modul MURNI, bukan di `lib/dokumen.ts`, semata supaya bisa diuji
 * tanpa MariaDB hidup: nilai yang sama juga di-seed `migrations/038` supaya
 * kotaknya di dashboard langsung berisi teks yang bisa disunting alih-alih
 * kosong, dan `dokumenDoc.test.ts` membaca berkas migrasinya untuk menjaga
 * keduanya TETAP SAMA -- pola yang sama dengan `labels.test.ts` terhadap
 * `INSERT INTO template`.
 *
 * Tanpa gerbang itu, memperbaiki kalimatnya di satu tempat menghasilkan dua
 * pesan berbeda tergantung apakah barisnya pernah disunting staf -- dan
 * bedanya tidak akan terlihat oleh siapa pun sampai ada yang membandingkan dua
 * pesan yang diterima dua pasien berbeda.
 */
export const PESAN_BAWAAN_DOKUMEN: Record<JenisDokumen, string> = {
  lab:
    'Bpk/Ibu {nama_pasien}, berikut hasil pemeriksaan laboratorium Anda dari {nama_rs} dalam bentuk berkas PDF. ' +
    'Hasil ini perlu dibaca bersama dokter -- silakan bawa saat kontrol atau hubungi {kontak_rs}. No. RM: {no_rm}. ' +
    'Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
  radiologi:
    'Bpk/Ibu {nama_pasien}, berikut hasil pemeriksaan radiologi Anda dari {nama_rs} dalam bentuk berkas PDF. ' +
    'Hasil ini perlu dibaca bersama dokter -- silakan bawa saat kontrol atau hubungi {kontak_rs}. No. RM: {no_rm}. ' +
    'Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
  nota:
    'Bpk/Ibu {nama_pasien}, berikut rincian tagihan Anda dari {nama_rs} dalam bentuk berkas PDF. ' +
    'Simpan berkas ini sebagai bukti. Bila ada yang perlu ditanyakan, hubungi {kontak_rs}. No. RM: {no_rm}. ' +
    'Balas "Berhenti Kirim Otomatis" untuk berhenti menerima pemberitahuan otomatis.',
};

/**
 * Nama berkas yang dilihat pasien di WhatsApp.
 *
 * TIDAK memuat nama pasien, berbeda dari `namaBerkasSurat()`.
 *
 * Di sana nama pasien ada supaya surat keterangan sakit yang tersimpan di
 * ponsel masih bisa dikenali berbulan-bulan kemudian, dan isinya memang sudah
 * dokumen bernama. Di sini pertimbangannya berbalik: nama berkas adalah bagian
 * yang PALING kelihatan -- ia muncul di daftar chat, di pratinjau notifikasi,
 * dan di layar kunci, sebelum siapa pun membuka berkasnya. Nama berkas yang
 * menyebut pasien memberi tahu siapa pun yang lewat bahwa orang ini baru saja
 * diperiksa laboratorium; nama yang netral tidak. Yang membedakan satu berkas
 * dari berkas lain tetap ada di dalamnya, dan tanggalnya ikut supaya dua hasil
 * di ponsel yang sama tidak bertimpa.
 *
 * SELALU `.pdf`, dan itu bukan kebetulan melainkan keputusan: dokumen ini
 * beredar sebagai pegangan -- hasil pemeriksaan yang dibawa ke dokter lain,
 * nota yang jadi bukti bayar -- dan bentuk yang bisa disunting penerimanya
 * membuat angkanya berhenti bisa dijamin sama dengan yang diterbitkan rumah
 * sakit. Ekstensinya ikut menentukan MIME kiriman (`MessageMedia.fromFilePath()`
 * menurunkannya dari nama berkas), jadi ia bukan sekadar label.
 */
export function namaBerkasDokumen(jenis: JenisDokumen, tanggalIso: string | null | undefined): string {
  const judul = jenis === 'lab' ? 'Hasil-Laboratorium' : jenis === 'radiologi' ? 'Hasil-Radiologi' : 'Rincian-Tagihan';
  const tgl = formatTanggalRingkas(tanggalIso).replace(/-/g, '');
  return tgl ? `${judul}-${tgl}.pdf` : `${judul}.pdf`;
}

/** Kepala dokumen -- sama bentuknya untuk ketiganya, supaya tidak menyimpang. */
export interface KepalaDokumen {
  jenis: JenisDokumen;
  noRawat: string;
  noRm: string;
  namaPasien: string;
  identitas: BarisIsian[];
  /** "8 Agustus 2026" -- tanggal KEJADIAN dokumen, bukan tanggal cetak. */
  tanggalDokumen: string;
  /** "08-08-2026", HANYA untuk isi QR -- lihat `formatTanggalRingkas()`. */
  tanggalRingkas: string;
  namaDokter: string;
  kdDokter: string;
  /** Label di atas nama penanda tangan, mis. "Dokter Penanggung Jawab,". */
  labelTandaTangan: string;
}

export interface BarisParameterLab {
  pemeriksaan: string;
  hasil: string;
  satuan: string;
  rujukan: string;
  keterangan: string;
}

export interface KelompokLab {
  /** Nama panel/paket; kosong bila katalognya tidak menyebutkannya. */
  panel: string;
  baris: BarisParameterLab[];
}

export interface IsiDokumenLab {
  jenis: 'lab';
  kepala: KepalaDokumen;
  kelompok: KelompokLab[];
  namaPetugas: string;
}

export interface BacaanRadiologi {
  jam: string;
  teks: string;
}

export interface IsiDokumenRadiologi {
  jenis: 'radiologi';
  kepala: KepalaDokumen;
  /** Nama pemeriksaan yang dilakukan; bisa lebih dari satu untuk satu bacaan. */
  pemeriksaan: string[];
  bacaan: BacaanRadiologi[];
}

/**
 * Satu baris nota.
 *
 * Susunan Khanza dipertahankan apa adanya alih-alih disusun ulang jadi struktur
 * bersarang: bentuk nota di layar Khanza sudah dikenali kasir dan pasien, dan
 * dokumen yang menyusunnya ulang berhenti bisa dicocokkan baris per baris
 * dengan lembar di loket.
 *
 *   `seksi`       judul kelompok ("Obat & BHP"). Kadang membawa angkanya
 *                 sendiri -- baris "Registrasi" menyimpan tarifnya di situ.
 *   `item`        satu layanan/obat berikut BANYAKNYA -- tanpa satu pun
 *                 angka rupiah; lihat `BarisNotaDokumen`.
 *   `subtotal`    jumlah kelompok di atasnya.
 *   `keterangan`  baris teks tanpa angka, mis. nama dokter di bawah "Dokter :".
 *   `total`       jumlah SELURUH baris di atasnya -- dihitung di sini, karena
 *                 `billing` memang tidak menyimpannya (lihat `susunNota`).
 */
export type JenisBarisNota = 'seksi' | 'item' | 'subtotal' | 'keterangan' | 'total';

/**
 * TIDAK ADA rupiah pada baris `item`, dan ketiadaannya disengaja.
 *
 * Nota Khanza mencetak tarif satuan DAN jumlah rupiah untuk tiap layanan;
 * berkas ini sengaja tidak. Yang dijawab sebuah nota yang beredar lewat
 * WhatsApp adalah "berapa yang harus saya bayar" plus "untuk apa saja" --
 * bukan daftar harga satuan rumah sakit, yang begitu berpindah tangan berhenti
 * bisa dijelaskan siapa pun dan berumur jauh lebih panjang daripada tarif yang
 * berlaku saat itu.
 *
 * Karena itu `total` hanya terisi pada baris `seksi`/`subtotal`/`total`, dan
 * kolom tarif satuan tidak ada sama sekali sebagai field -- field yang ada tapi
 * tidak pernah dirender adalah persis cara perubahan berikutnya diam-diam
 * mengembalikannya ke halaman.
 *
 * Angkanya TETAP dijumlahkan penuh (`susunNota`), jadi total tagihannya sama
 * persis dengan yang dibayar di kasir.
 */
export interface BarisNotaDokumen {
  jenis: JenisBarisNota;
  label: string;
  /** Banyaknya layanan/obat. Bukan rupiah -- lihat catatan di atas. */
  jumlah: string;
  /** Rupiah; KOSONG untuk baris `item` dan `keterangan`. */
  total: string;
}

export interface BarisPembayaranDokumen {
  label: string;
  nilai: string;
}

export interface IsiDokumenNota {
  jenis: 'nota';
  kepala: KepalaDokumen;
  noNota: string;
  namaPoli: string;
  caraBayar: string;
  baris: BarisNotaDokumen[];
  pembayaran: BarisPembayaranDokumen[];
  /**
   * Rincian obat diringkas jadi satu baris total.
   *
   * Ditandai supaya dokumennya bisa MENGATAKANNYA, bukan diam-diam kehilangan
   * baris. Nota yang jumlah barisnya berkurang tanpa keterangan terbaca sebagai
   * nota yang salah, dan pasien yang menghitung sendiri akan menemukan selisih
   * yang tidak bisa dijelaskan siapa pun.
   */
  obatDiringkas: boolean;
}

export type IsiDokumen = IsiDokumenLab | IsiDokumenRadiologi | IsiDokumenNota;

/** Bentuk baris identitas yang dibaca penyusun -- struktural, bukan tipe khanza/. */
export interface BarisIdentitasMasuk {
  no_rawat: string;
  tgl_registrasi: string | null;
  umurdaftar: number | null;
  sttsumur: string | null;
  no_rkm_medis: string;
  nm_poli: string | null;
  nm_pasien: string | null;
  jk: string | null;
  tgl_lahir: string | null;
  alamat: string | null;
  nm_kel: string | null;
  nm_kec: string | null;
  nm_kab: string | null;
  png_jawab: string | null;
  nm_dokter: string | null;
  kd_dokter: string | null;
}

/**
 * Baris identitas pasien, dipakai KETIGA dokumen.
 *
 * `no_ktp` sengaja tidak ada walau `rptPeriksaLab` mencetaknya -- lihat
 * `khanza/dokumenHasil.ts`. Umur dari `reg_periksa.umurdaftar` (umur SAAT
 * MENDAFTAR), bukan dihitung dari `tgl_lahir` terhadap hari ini: itu yang
 * dipakai Khanza, dan dokumen yang dicetak ulang tahun depan harus tetap
 * menyebut umur yang sama.
 */
function identitasDokumen(row: BarisIdentitasMasuk): BarisIsian[] {
  return [
    { label: 'Nama', nilai: isianSurat(row.nm_pasien) },
    { label: 'No. Rekam Medis', nilai: isianSurat(row.no_rkm_medis) },
    { label: 'Tanggal Lahir', nilai: formatTanggalSurat(row.tgl_lahir) },
    { label: 'Jenis Kelamin', nilai: jenisKelaminLengkap(row.jk) },
    { label: 'Umur', nilai: formatUmurSurat(row.umurdaftar, row.sttsumur) },
    {
      label: 'Alamat',
      nilai: rakitAlamat({
        alamat: row.alamat,
        kelurahan: row.nm_kel,
        kecamatan: row.nm_kec,
        kabupaten: row.nm_kab,
      }),
    },
  ];
}

function susunKepala(
  jenis: JenisDokumen,
  row: BarisIdentitasMasuk,
  opsi: { tanggal: string | null; namaDokter: string; kdDokter: string; labelTandaTangan: string },
): KepalaDokumen {
  /**
   * Tanggal kejadian dokumen, JATUH KEMBALI ke tanggal registrasi.
   *
   * Hasil lab dan radiologi punya `tgl_periksa` sendiri; nota tidak punya
   * kolom tanggal di `billing` sama sekali dan tanggalnya datang dari
   * `nota_jalan`/`nota_inap`. Yang kosong jatuh ke tanggal kunjungan alih-alih
   * dibiarkan kosong: dokumen bertanggal adalah yang membedakan dua hasil
   * pemeriksaan pasien yang sama di ponselnya.
   */
  const tanggal = opsi.tanggal?.trim() || row.tgl_registrasi;
  return {
    jenis,
    noRawat: row.no_rawat,
    noRm: row.no_rkm_medis,
    namaPasien: isianSurat(row.nm_pasien),
    identitas: identitasDokumen(row),
    tanggalDokumen: formatTanggalSurat(tanggal),
    tanggalRingkas: formatTanggalRingkas(tanggal),
    namaDokter: isianSurat(opsi.namaDokter),
    kdDokter: isianSurat(opsi.kdDokter),
    labelTandaTangan: opsi.labelTandaTangan,
  };
}

// ---------------------------------------------------------------------------
// HASIL LABORATORIUM
// ---------------------------------------------------------------------------

export interface BarisHasilLabMasuk {
  panel: string | null;
  pemeriksaan: string | null;
  nilai: string | null;
  satuan: string | null;
  nilai_rujukan: string | null;
  keterangan: string | null;
  nm_petugas: string | null;
  nm_dokter_pj: string | null;
  kd_dokter_pj: string | null;
}

/**
 * Parameter DIKELOMPOKKAN per panel, dan urutan panel mengikuti urutan
 * kedatangannya -- bukan diurutkan ulang di sini.
 *
 * SQL-nya sudah `ORDER BY jp.nm_perawatan, tl.urut`, jadi mengurutkan lagi di
 * sini berarti dua tempat memutuskan urutan yang sama. Yang dikerjakan cuma
 * mengelompokkan berurutan.
 *
 * Parameter yang `nilai`-nya KOSONG tetap ditampilkan, tidak dibuang. Di
 * database ini 6 dari 73 baris detail kosong -- itu parameter yang diminta tapi
 * belum keluar hasilnya, dan menghilangkannya membuat pasien membaca panel yang
 * tampak lengkap padahal ada yang belum selesai. Yang kosong dirender sebagai
 * garis pendek di kolom hasilnya, jadi ketiadaannya terlihat.
 */
export function susunHasilLab(
  identitas: BarisIdentitasMasuk,
  baris: BarisHasilLabMasuk[],
  tglPeriksa: string | null,
): IsiDokumenLab {
  const kelompok: KelompokLab[] = [];
  for (const b of baris) {
    const panel = isianSurat(b.panel);
    const terakhir = kelompok[kelompok.length - 1];
    const tujuan = terakhir && terakhir.panel === panel ? terakhir : (kelompok.push({ panel, baris: [] }), kelompok[kelompok.length - 1]!);
    tujuan.baris.push({
      pemeriksaan: isianSurat(b.pemeriksaan),
      hasil: isianSurat(b.nilai),
      satuan: isianSurat(b.satuan),
      rujukan: isianSurat(b.nilai_rujukan),
      keterangan: isianSurat(b.keterangan),
    });
  }

  const pertama = baris[0];
  return {
    jenis: 'lab',
    kepala: susunKepala('lab', identitas, {
      tanggal: tglPeriksa,
      // Penanggung jawab pemeriksaan, bukan dokter poli -- itu yang dipakai
      // Khanza sebagai penanda tangan di `rptPeriksaLab` dan sebagai isi QR.
      namaDokter: pertama?.nm_dokter_pj ?? identitas.nm_dokter ?? '',
      kdDokter: pertama?.kd_dokter_pj ?? identitas.kd_dokter ?? '',
      labelTandaTangan: 'Dokter Penanggung Jawab,',
    }),
    kelompok,
    namaPetugas: isianSurat(pertama?.nm_petugas),
  };
}

// ---------------------------------------------------------------------------
// HASIL RADIOLOGI
// ---------------------------------------------------------------------------

export interface BarisBacaanMasuk {
  jam: string;
  hasil: string | null;
}

export interface BarisPemeriksaanRadiologiMasuk {
  jam: string;
  nm_perawatan: string | null;
  nm_dokter_pj: string | null;
  kd_dokter_pj: string | null;
}

/**
 * Narasi bacaan diteruskan APA ADANYA, hanya dirapikan akhir barisnya.
 *
 * Isinya kalimat bebas yang diketik dokter radiologi, dan justru karena bebas
 * ia tidak boleh dipotong, diringkas, atau dinormalkan -- satu kata yang hilang
 * dari sebuah bacaan radiologi bisa membalik artinya. Pelolosan HTML-nya
 * dikerjakan `core/dokumenHtml.ts`, sama seperti nilai lain.
 *
 * Baris kosong ganda dirapatkan karena Khanza menyimpannya apa adanya dari
 * kotak teks, dan tiga baris kosong berturut-turut di tengah dokumen A4
 * terbaca sebagai halaman yang rusak.
 */
export function susunHasilRadiologi(
  identitas: BarisIdentitasMasuk,
  bacaan: BarisBacaanMasuk[],
  pemeriksaan: BarisPemeriksaanRadiologiMasuk[],
  tglPeriksa: string | null,
): IsiDokumenRadiologi {
  const nama: string[] = [];
  for (const p of pemeriksaan) {
    const n = isianSurat(p.nm_perawatan);
    if (n && !nama.includes(n)) nama.push(n);
  }
  const pertama = pemeriksaan[0];
  return {
    jenis: 'radiologi',
    kepala: susunKepala('radiologi', identitas, {
      tanggal: tglPeriksa,
      namaDokter: pertama?.nm_dokter_pj ?? identitas.nm_dokter ?? '',
      kdDokter: pertama?.kd_dokter_pj ?? identitas.kd_dokter ?? '',
      labelTandaTangan: 'Dokter Penanggung Jawab,',
    }),
    pemeriksaan: nama,
    bacaan: bacaan
      .map((b) => ({ jam: b.jam, teks: (b.hasil ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }))
      .filter((b) => b.teks !== ''),
  };
}

// ---------------------------------------------------------------------------
// NOTA / TAGIHAN
// ---------------------------------------------------------------------------

export interface BarisNotaMasuk {
  /** LABEL KIRI (kolom `no` di Khanza) -- lihat `khanza/dokumenHasil.ts`. */
  no_baris: string | null;
  nm_perawatan: string | null;
  pemisah: string | null;
  biaya: number | null;
  jumlah: number | null;
  totalbiaya: number | null;
  status: string | null;
}

export interface BarisPembayaranMasuk {
  nama_bayar: string;
  besarppn: number | null;
  besar_bayar: number | null;
}

/**
 * Baris kepala nota yang sudah dirangkai Khanza sebagai teks, DIBUANG.
 *
 * Tujuh baris pertama tiap nota ber-`status = '-'` dan mengulang identitas
 * pasien -- termasuk alamat yang dirangkai apa adanya sehingga berbunyi
 * "..., KELURAHAN, KECAMATAN, KABUPATEN" untuk 89% pasien di database ini.
 * Kepala dokumen di sini dibangun ulang dari kolomnya lewat `isianSurat()`,
 * jadi meneruskan versi Khanza berarti dokumen yang menyebut identitas pasien
 * DUA KALI dengan dua bentuk yang berbeda, salah satunya rusak.
 */
const STATUS_KEPALA = '-';

/**
 * Status yang barisnya menyebut NAMA OBAT.
 *
 * Ketiganya, bukan cuma 'Obat': resep pulang dan retur obat sama-sama memuat
 * nama dagang, dan menyaring salah satunya saja menghasilkan sakelar yang
 * bocor lewat pintu sebelah tanpa satu pun galat.
 */
const STATUS_OBAT = new Set(['Obat', 'Resep Pulang', 'Retur Obat']);

/** `status` berawalan 'Ttl' menandai baris SUBTOTAL kelompok di atasnya. */
function barisSubtotal(status: string): boolean {
  return status.startsWith('Ttl');
}

/**
 * Angka negatif ditulis `-Rp5.000`, bukan `Rp-5.000`.
 *
 * `formatRupiah()` menempelkan "Rp" di depan apa adanya, dan potongan biaya
 * memang tersimpan negatif di `billing`. Bentuk "Rp-5.000" terbaca sebagai
 * salah ketik pada dokumen yang seluruh gunanya adalah angka yang bisa
 * dipercaya.
 */
function rupiahBertanda(nilai: number | null): string {
  if (nilai === null || nilai === undefined || !Number.isFinite(Number(nilai))) return '';
  const n = Number(nilai);
  return n < 0 ? `-${formatRupiah(-n)}` : formatRupiah(n);
}

export interface OpsiNota {
  /** false = baris obat diringkas jadi satu total (dokumen.nota_rincian_obat). */
  rincianObat: boolean;
}

export function susunNota(
  identitas: BarisIdentitasMasuk,
  baris: BarisNotaMasuk[],
  pembayaran: BarisPembayaranMasuk[],
  noNota: string | null,
  tanggalNota: string | null,
  opsi: OpsiNota,
): IsiDokumenNota {
  const hasil: BarisNotaDokumen[] = [];
  let obatDiringkas = false;
  let subtotalBerjalan = 0;
  let totalSeluruh = 0;

  for (const b of baris) {
    const status = (b.status ?? '').trim();
    if (status === STATUS_KEPALA) continue;

    const item = (b.pemisah ?? '').trim() === ':';
    const nilai = Number(b.totalbiaya);
    const angka = Number.isFinite(nilai) ? nilai : 0;

    /**
     * Total DIJUMLAHKAN di sini, dan itu bukan pilihan gaya.
     *
     * `billing` TIDAK menyimpan angka penutupnya: Khanza merakit "TOTAL
     * TAGIHAN / PPN / TOTAL BAYAR" saat mencetak, ke tabel sementara
     * (`temporary_bayar_ralan`), bukan ke `billing`. Jadi nota tanpa
     * penjumlahan di sini adalah daftar tanpa jumlah -- dan nota yang tidak
     * berjumlah menimbulkan telepon alih-alih menjawabnya.
     *
     * Aman dijumlahkan karena baris subtotal (`Ttl*`) selalu ber-`totalbiaya`
     * NOL -- terukur 0 dari 11.585 baris menyimpang -- jadi tidak ada yang
     * terhitung dua kali. Diperiksa juga terhadap `detail_nota_jalan`: 8.630
     * dari 8.642 nota cocok persis. Sisanya itulah alasan bagian PEMBAYARAN
     * tetap ditampilkan apa adanya dari Khanza alih-alih diganti angka ini --
     * yang satu menjumlahkan apa yang TERCETAK, yang satu menyebut apa yang
     * DIBAYAR, dan keduanya tetap benar sendiri-sendiri saat berbeda.
     */
    totalSeluruh += angka;

    /**
     * Baris ITEM obat dilewati saat rincian dimatikan; judul kelompoknya dan
     * subtotalnya TETAP ada, dan angkanya TETAP masuk hitungan.
     *
     * Menghapus ketiganya akan membuat angka notanya tidak berjumlah, dan nota
     * yang tidak bisa dicocokkan dengan yang dibayar di kasir adalah nota yang
     * menimbulkan telepon alih-alih menjawabnya. Yang disembunyikan cuma NAMA
     * obatnya -- totalnya tetap terbaca, dan dokumennya mengatakan bahwa
     * rinciannya sengaja tidak dicantumkan.
     */
    if (item && STATUS_OBAT.has(status) && !opsi.rincianObat) {
      obatDiringkas = true;
      subtotalBerjalan += angka;
      continue;
    }

    if (item) {
      subtotalBerjalan += angka;
      hasil.push({
        jenis: 'item',
        label: isianSurat(b.nm_perawatan),
        jumlah: formatJumlah(b.jumlah),
        // Rupiah baris ini sengaja tidak diteruskan -- `angka` di atas sudah
        // masuk `subtotalBerjalan` dan `totalSeluruh`, jadi yang hilang cuma
        // tampilannya, bukan hitungannya.
        total: '',
      });
      continue;
    }

    /**
     * Baris subtotal: angkanya DIHITUNG ULANG, bukan dibaca dari
     * `nm_perawatan`.
     *
     * Khanza menaruh subtotal yang sudah diformat sebagai TEKS di kolom nama
     * ("31,655"). Meneruskannya berarti dokumen ini memuat satu angka yang
     * formatnya berbeda dari semua angka lain di halaman yang sama, DAN yang
     * tidak bisa dijamin cocok dengan baris yang benar-benar tercetak di
     * atasnya -- persis saat rincian obat diringkas. Menjumlahkan sendiri
     * membuat keduanya mustahil menyimpang.
     */
    if (barisSubtotal(status)) {
      hasil.push({
        jenis: 'subtotal',
        label: 'Subtotal',
        jumlah: '',
        total: rupiahBertanda(subtotalBerjalan),
      });
      subtotalBerjalan = 0;
      continue;
    }

    const labelSeksi = isianSurat(b.no_baris);
    if (labelSeksi) {
      subtotalBerjalan = 0;
      hasil.push({
        jenis: 'seksi',
        label: labelSeksi,
        jumlah: '',
        // Baris "Registrasi" membawa tarifnya sendiri di kolom total; kelompok
        // lain nol, dan nol di sini berarti "tidak ada angka", bukan "gratis".
        total: angka !== 0 ? rupiahBertanda(angka) : '',
      });
      continue;
    }

    // Sisa: baris teks tanpa angka (nama dokter di bawah judul "Dokter :").
    const teks = isianSurat(b.nm_perawatan);
    if (teks) hasil.push({ jenis: 'keterangan', label: teks, jumlah: '', total: '' });
  }

  if (hasil.length > 0) {
    hasil.push({ jenis: 'total', label: 'TOTAL', jumlah: '', total: rupiahBertanda(totalSeluruh) });
  }

  return {
    jenis: 'nota',
    kepala: susunKepala('nota', identitas, {
      tanggal: tanggalNota,
      namaDokter: identitas.nm_dokter ?? '',
      kdDokter: identitas.kd_dokter ?? '',
      // Nota bukan pernyataan medis: yang mengesahkannya kasir, bukan dokter.
      // Nama dokternya tetap tercantum di kepala dokumen sebagai keterangan
      // kunjungan, dan itu memang perannya di sini.
      labelTandaTangan: 'Petugas Kasir,',
    }),
    noNota: isianSurat(noNota),
    namaPoli: isianSurat(identitas.nm_poli),
    caraBayar: isianSurat(identitas.png_jawab),
    baris: hasil,
    pembayaran: pembayaran.flatMap((p) => {
      const nilai = rupiahBertanda(p.besar_bayar);
      const ppn = rupiahBertanda(p.besarppn);
      const label = isianSurat(p.nama_bayar);
      if (!label || !nilai) return [];
      return [{ label, nilai: ppn && Number(p.besarppn) > 0 ? `${nilai} (PPN ${ppn})` : nilai }];
    }),
    obatDiringkas,
  };
}

// ---------------------------------------------------------------------------
// Asal-usul dokumen
// ---------------------------------------------------------------------------

/**
 * Isi QR pengesahan -- bentuknya MENGIKUTI `teksAsalUsul()` milik surat, yang
 * sendirinya mengikuti parameter `finger` Khanza persis.
 *
 * Tidak diimpor dari sana karena tipe masukannya berbeda (`IsiSurat` vs
 * `KepalaDokumen`), tapi susunan barisnya wajib sama: satu-satunya guna QR ini
 * adalah supaya dokumen yang diterima lewat WhatsApp bisa DIBANDINGKAN dengan
 * yang dicetak di loket, dan susunan yang menyimpang satu kata pun membuat
 * perbandingan itu berhenti membuktikan apa pun.
 *
 * Tidak ada satu pun data pasien di dalamnya, dan itu disengaja -- Khanza pun
 * tidak memuatnya. QR ini mengesahkan SIAPA YANG MENERBITKAN, bukan siapa yang
 * disebut, dan bentuk yang terbaca mesin membuat pemanenan borongan jadi murah.
 */
export function teksAsalUsulDokumen(kop: KopSurat, kepala: KepalaDokumen): string {
  const tempat = [kop.namaRs.trim(), kop.kotaRs.trim() && `Kabupaten/Kota ${kop.kotaRs.trim()}`]
    .filter(Boolean)
    .join(', ');
  return [
    tempat && `Dikeluarkan di ${tempat}`,
    kepala.namaDokter && `Ditandatangani secara elektronik oleh ${kepala.namaDokter}`,
    kepala.kdDokter && `ID ${kepala.kdDokter}`,
    kepala.tanggalRingkas,
  ]
    .filter(Boolean)
    .join('\n');
}
