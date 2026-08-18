/**
 * Dokumen CONTOH berisi data karangan -- dipakai HANYA saat Khanza belum punya
 * satu pun kejadian dari jenis yang bersangkutan.
 *
 * ==========================================================================
 * Kenapa ini ada, padahal pratinjau sengaja memakai data SUNGGUHAN
 * ==========================================================================
 *
 * `pratinjau-dokumen/route.ts` mengambil kejadian terbaru yang sungguhan, dan
 * alasannya masih berlaku: dokumen contoh berisi angka karangan tidak
 * membuktikan apa pun tentang bentuk data Khanza, dan justru bentuk data itu
 * yang berkali-kali jadi sumber kejutan di proyek ini.
 *
 * Tapi ada satu keadaan yang membuat aturan itu buntu, dan keadaan itu NYATA di
 * instalasi ini: `hasil_radiologi` dan `periksa_radiologi` NOL baris (terukur 18
 * Agustus 2026, di `alca` maupun di salinan `sik`). Tanpa contoh, tombolnya
 * hilang dan yang tersisa cuma kalimat "belum ada yang bisa dijadikan contoh" --
 * sehingga sakelar yang MENGIRIM BERKAS BERISI NARASI DOKTER ke pasien harus
 * diputuskan tanpa seorang pun pernah melihat bentuk berkasnya. Itu pertukaran
 * yang salah arah: yang hilang dari contoh karangan cuma keyakinan tentang
 * bentuk DATA, sementara bentuk HALAMAN -- kop, susunan, kalimat peringatan,
 * tanda tangan, QR -- persis sama karena berangkat dari penyusun yang sama.
 *
 * DUA pagar yang menempel, dan keduanya perlu:
 *
 *   1. Melewati `susunHasilLab()`/`susunHasilRadiologi()`/`susunNota()` yang
 *      SAMA dipakai worker, bukan merakit `IsiDokumen` dengan tangan. Contoh
 *      yang dirakit sendiri akan tetap terlihat benar justru saat penyusunnya
 *      rusak -- yaitu satu-satunya saat pratinjau perlu berbunyi.
 *   2. Halamannya WAJIB mengatakan dirinya contoh (`renderDokumenHtml` opsi
 *      `contoh`). Berkas ini bisa diunduh dan diteruskan seperti berkas lain;
 *      dokumen rumah sakit berisi angka karangan yang tidak menyebut dirinya
 *      karangan adalah dokumen palsu, apa pun niat pembuatnya.
 *
 * Nilainya sengaja dibuat MENCOLOK palsu (nama "PASIEN CONTOH", No. RM
 * "000000", `no_rawat` "0000/00/00/000000"), bukan nama yang tampak wajar.
 */

import {
  type BarisIdentitasMasuk,
  type BarisHasilLabMasuk,
  type BarisBacaanMasuk,
  type BarisPemeriksaanRadiologiMasuk,
  type BarisNotaMasuk,
  type IsiDokumen,
  type JenisDokumen,
  susunHasilLab,
  susunHasilRadiologi,
  susunNota,
} from './dokumenDoc';

/** Satu-satunya tempat nama-nama karangan itu ditulis. */
const NO_RAWAT_CONTOH = '0000/00/00/000000';

function identitasContoh(tanggal: string, namaPoli: string): BarisIdentitasMasuk {
  return {
    no_rawat: NO_RAWAT_CONTOH,
    tgl_registrasi: tanggal,
    umurdaftar: 35,
    sttsumur: 'Th',
    no_rkm_medis: '000000',
    nm_poli: namaPoli,
    nm_pasien: 'PASIEN CONTOH',
    jk: 'L',
    tgl_lahir: '1990-01-01',
    alamat: 'ALAMAT CONTOH',
    nm_kel: 'KELURAHAN CONTOH',
    nm_kec: 'KECAMATAN CONTOH',
    nm_kab: 'KABUPATEN CONTOH',
    png_jawab: 'UMUM',
    nm_dokter: 'dr. CONTOH',
    kd_dokter: 'D000000',
  };
}

const LAB_CONTOH: BarisHasilLabMasuk[] = [
  {
    panel: 'DARAH LENGKAP',
    pemeriksaan: 'Hemoglobin',
    nilai: '13.5',
    satuan: 'g/dL',
    nilai_rujukan: '13.0 - 17.0',
    keterangan: '',
    nm_petugas: 'PETUGAS CONTOH',
    nm_dokter_pj: 'dr. CONTOH',
    kd_dokter_pj: 'D000000',
  },
  {
    panel: 'DARAH LENGKAP',
    pemeriksaan: 'Leukosit',
    nilai: '11.200',
    satuan: '/uL',
    nilai_rujukan: '4.000 - 10.000',
    keterangan: 'H',
    nm_petugas: 'PETUGAS CONTOH',
    nm_dokter_pj: 'dr. CONTOH',
    kd_dokter_pj: 'D000000',
  },
  {
    /**
     * Satu parameter sengaja KOSONG hasilnya: itu keadaan sungguhan (panel yang
     * belum selesai) yang bentuknya perlu dilihat sebelum sakelarnya dinyalakan.
     */
    panel: 'DARAH LENGKAP',
    pemeriksaan: 'Trombosit',
    nilai: '',
    satuan: '/uL',
    nilai_rujukan: '150.000 - 400.000',
    keterangan: '',
    nm_petugas: 'PETUGAS CONTOH',
    nm_dokter_pj: 'dr. CONTOH',
    kd_dokter_pj: 'D000000',
  },
];

/**
 * Bacaan radiologi karangan, dan panjangnya disengaja.
 *
 * Yang perlu dilihat rumah sakit sebelum menyalakan sakelarnya BUKAN bahwa
 * kotaknya terisi, melainkan bahwa apa pun yang diketik dokter berangkat utuh:
 * narasi berparagraf, istilah teknis, dan baris "Kesan" di ujungnya.
 */
const RADIOLOGI_BACAAN_CONTOH: BarisBacaanMasuk[] = [
  {
    jam: '09:15:00',
    hasil:
      'Cor: ukuran dan bentuk dalam batas normal.\n' +
      'Pulmo: corakan bronkovaskular normal. Tidak tampak infiltrat maupun nodul.\n' +
      'Sinus costophrenicus kanan dan kiri tajam. Diafragma licin.\n' +
      'Tulang-tulang dan jaringan lunak dinding dada tidak tampak kelainan.\n\n' +
      'Kesan: Cor dan pulmo dalam batas normal.',
  },
];

const RADIOLOGI_PERIKSA_CONTOH: BarisPemeriksaanRadiologiMasuk[] = [
  { jam: '09:15:00', nm_perawatan: 'Foto Thorax PA', nm_dokter_pj: 'dr. CONTOH', kd_dokter_pj: 'D000000' },
];

const NOTA_CONTOH: BarisNotaMasuk[] = [
  { no_baris: 'Registrasi', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 25000, status: 'Registrasi' },
  { no_baris: 'Dokter', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Dokter' },
  { no_baris: '', nm_perawatan: 'dr. CONTOH', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Dokter' },
  { no_baris: 'Tindakan', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Tindakan' },
  {
    no_baris: '',
    nm_perawatan: 'Pemeriksaan Dokter Umum',
    pemisah: ':',
    biaya: 50000,
    jumlah: 1,
    totalbiaya: 50000,
    status: 'Tindakan',
  },
  { no_baris: '', nm_perawatan: '50,000', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'TtlTindakan' },
  { no_baris: 'Obat & BHP', nm_perawatan: ':', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'Obat' },
  { no_baris: '', nm_perawatan: 'OBAT CONTOH 500 mg', pemisah: ':', biaya: 1500, jumlah: 10, totalbiaya: 15000, status: 'Obat' },
  {
    no_baris: '',
    nm_perawatan: 'OBAT CONTOH SIRUP 60 ml',
    pemisah: ':',
    biaya: 18000,
    jumlah: 1,
    totalbiaya: 18000,
    status: 'Obat',
  },
  { no_baris: '', nm_perawatan: '33,000', pemisah: '', biaya: 0, jumlah: 0, totalbiaya: 0, status: 'TtlObat' },
];

export interface OpsiDokumenContoh {
  /** Tanggal yang dicetak di dokumen; diserahkan pemanggil supaya murni. */
  tanggal: string;
  /** Sama artinya dengan `dokumen.nota_rincian_obat` -- contohnya harus ikut. */
  rincianObat: boolean;
}

/**
 * Isi dokumen contoh untuk satu jenis.
 *
 * Selalu berhasil dan tidak pernah menyentuh database -- itu inti gunanya:
 * dipanggil justru pada keadaan yang membuat jalur sungguhan tidak menghasilkan
 * apa pun.
 */
export function contohIsiDokumen(jenis: JenisDokumen, opsi: OpsiDokumenContoh): IsiDokumen {
  if (jenis === 'lab') {
    return susunHasilLab(identitasContoh(opsi.tanggal, 'LABORATORIUM'), LAB_CONTOH, opsi.tanggal);
  }
  if (jenis === 'radiologi') {
    return susunHasilRadiologi(
      identitasContoh(opsi.tanggal, 'RADIOLOGI'),
      RADIOLOGI_BACAAN_CONTOH,
      RADIOLOGI_PERIKSA_CONTOH,
      opsi.tanggal,
    );
  }
  return susunNota(
    identitasContoh(opsi.tanggal, 'UMUM'),
    NOTA_CONTOH,
    [{ nama_bayar: 'Tunai', besarppn: 0, besar_bayar: 108000 }],
    'CONTOH/0000',
    opsi.tanggal,
    { rincianObat: opsi.rincianObat },
  );
}
