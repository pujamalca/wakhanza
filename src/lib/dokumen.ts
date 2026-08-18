import { getSetting, getSettingBool, getSettingJson } from '@/models';
import { lolosSaringPenjamin } from '@/core/penjamin';
import { bacaKopSurat, rakitCatatanKaki, buatQrAsalUsul } from '@/lib/cetak';
import {
  type IsiDokumen,
  type JenisDokumen,
  PESAN_BAWAAN_DOKUMEN,
  susunHasilLab,
  susunHasilRadiologi,
  susunNota,
  teksAsalUsulDokumen,
} from '@/core/dokumenDoc';
import { renderDokumenHtml } from '@/core/dokumenHtml';
import { contohIsiDokumen } from '@/core/dokumenContoh';
import { tanggalLokal } from '@/core/bpjs';
import { htmlKePdf } from '@/lib/pdf';
import {
  ambilIdentitasKunjungan,
  ambilHasilLab,
  ambilHasilRadiologi,
  ambilNota,
  ambilContohKejadian,
  ambilKdPjKunjungan,
} from '@/khanza/dokumenHasil';

/**
 * Perakit baris Khanza -> isi dokumen hasil, DAN satu-satunya tempat yang
 * membaca pengaturan `dokumen.*` (migrations/038).
 *
 * Berdiri di antara `khanza/dokumenHasil.ts` (baca database, tanpa pengaturan)
 * dan `core/dokumenDoc.ts` / `core/dokumenHtml.ts` (fungsi murni, tanpa
 * keduanya). Batas itu yang membuat `npm run verify:db` tetap bisa membuktikan
 * `sik` hanya dibaca, dan yang membuat pratinjau di layar memakai penurunan
 * yang sama persis dengan berkas yang benar-benar terkirim.
 *
 * Bentuknya mengikuti `lib/surat.ts` sedekat mungkin -- termasuk memakai
 * `lib/cetak.ts` yang sama untuk kop, QR, dan catatan kaki, supaya kelima
 * berkas yang keluar dari nomor WhatsApp ini terlihat berasal dari satu rumah
 * sakit.
 */

export const SETTING_AKTIF: Record<JenisDokumen, string> = {
  lab: 'dokumen.lab_enabled',
  radiologi: 'dokumen.rad_enabled',
  nota: 'dokumen.nota_enabled',
};

export const SETTING_PESAN: Record<JenisDokumen, string> = {
  lab: 'dokumen.pesan_lab',
  radiologi: 'dokumen.pesan_rad',
  nota: 'dokumen.pesan_nota',
};

/**
 * Daftar KODE penjamin yang boleh menerima lampiran, PER JENIS dokumen
 * (migrations/048). JSON array `kd_pj`; KOSONG = seluruh penjamin.
 *
 * Per jenis dan bukan satu untuk seluruh tab, dan itu bukan kerapian melainkan
 * mengikuti pertanyaan yang berbeda-beda. Terukur 90 hari di instalasi ini:
 * nota tagihan 1.324 UMUM berbanding 574 BPJS, sementara hasil lab 11 baris yang
 * SELURUHNYA BPJS. Sebuah nota tagihan tidak berarti apa-apa bagi pasien yang
 * tagihannya ditanggung penjamin; hasil laboratorium sama pentingnya bagi
 * siapa pun. Satu penyaring untuk ketiganya memaksa kedua pertanyaan itu dijawab
 * dengan satu jawaban.
 *
 * Ketiga sakelar `dokumen.*_enabled` di tab yang sama sudah per jenis, jadi
 * penyaring tunggal akan jadi satu-satunya setelan di sana yang tidak.
 */
export const SETTING_CARA_BAYAR: Record<JenisDokumen, string> = {
  lab: 'dokumen.lab_cara_bayar',
  radiologi: 'dokumen.rad_cara_bayar',
  nota: 'dokumen.nota_cara_bayar',
};

export const SETTING_RINCIAN_OBAT = 'dokumen.nota_rincian_obat';
export const SETTING_KUOTA = 'dokumen.max_per_siklus';
export const SETTING_CATATAN_KAKI = 'dokumen.catatan_kaki';

export const KUOTA_BAWAAN = 5;

/**
 * Diekspor ulang dari modul murninya supaya pemanggil (halaman /administrasi)
 * cukup mengimpor satu tempat -- teksnya sendiri tinggal di
 * `core/dokumenDoc.ts` karena di sanalah ia bisa diuji tanpa MariaDB hidup.
 */
export { PESAN_BAWAAN_DOKUMEN as PESAN_BAWAAN };

/**
 * Apakah jenis dokumen ini ikut dilampirkan.
 *
 * TIDAK bertingkat di bawah `administrasi.enabled`, dan itu disengaja walau
 * halamannya sama. Sakelar itu menjawab "boleh mengirim surat keterangan yang
 * dipicu STAF?" -- pertanyaan tentang wewenang menerbitkan dokumen. Yang ini
 * menjawab "boleh melampirkan hasil pemeriksaan pada pemberitahuan yang sudah
 * berjalan?", pertanyaan tentang data medis yang sama sekali tidak bergantung
 * pada jawaban yang pertama. Menyusunnya bertingkat akan memaksa rumah sakit
 * menyalakan penerbitan surat keterangan hanya untuk bisa melampirkan nota.
 *
 * Yang MENAHAN seluruhnya tetap `template.is_active` pemicunya: tanpa pemicu
 * yang menyala tidak ada pesan yang keluar, dan lampiran ini tidak punya apa
 * pun untuk ditempeli.
 */
export async function dokumenAktif(jenis: JenisDokumen): Promise<boolean> {
  return getSettingBool(SETTING_AKTIF[jenis], false);
}

export async function bacaPesanDokumen(jenis: JenisDokumen): Promise<string> {
  return (await getSetting(SETTING_PESAN[jenis]))?.trim() || PESAN_BAWAAN_DOKUMEN[jenis];
}

/**
 * Daftar kode penjamin yang boleh menerima lampiran jenis ini. Kosong = semua.
 *
 * Dibaca SEKALI per siklus oleh pollernya, bukan sekali per baris -- bentuk yang
 * sama dengan `bacaPesanDokumen()` dan kuotanya.
 */
export async function bacaCaraBayarDokumen(jenis: JenisDokumen): Promise<string[]> {
  const daftar = await getSettingJson<string[]>(SETTING_CARA_BAYAR[jenis], []);
  return Array.isArray(daftar) ? daftar.filter((k) => typeof k === 'string' && k.trim() !== '') : [];
}

/**
 * Apakah lampiran untuk satu kunjungan lolos penyaring cara bayar.
 *
 * `sik` disentuh HANYA bila daftarnya terisi -- jadi pada setelan bawaan
 * (kosong) ia nol query tambahan, dan migrasinya benar-benar nol-perubahan.
 * Urutan itu mengikat: memeriksa daftar SESUDAH membaca database berarti setiap
 * rumah sakit yang tidak memakai fitur ini tetap membayar satu query per
 * kejadian, selamanya.
 *
 * Keputusannya sendiri ada di `core/penjamin.ts` sebagai fungsi MURNI, berikut
 * ketiga kasus pinggirnya (daftar kosong, kode tak dikenal, penanda `'-'`) --
 * di sanalah ia bisa dipatok uji tanpa MariaDB hidup.
 */
export async function lolosCaraBayarDokumen(noRawat: string, daftarKode: readonly string[]): Promise<boolean> {
  if (daftarKode.length === 0) return true;
  return lolosSaringPenjamin(await ambilKdPjKunjungan(noRawat), daftarKode);
}

/**
 * Rincian nama obat pada nota.
 *
 * Dibaca DI SINI lalu diserahkan sebagai parameter ke `susunNota()`, bukan
 * dibaca di dalam modul `core/` maupun `khanza/` -- bentuk yang sama dengan
 * `farmasi.stok_pakai_batch` dan `administrasi.sertakan_diagnosa`.
 *
 * Bedanya dari kedua contoh itu, dan ini harus disadari: di sini kolomnya TETAP
 * di-SELECT. `billing` adalah satu tabel yang barisnya bercampur -- nama obat
 * dan nama tindakan duduk di kolom `nm_perawatan` yang sama, dibedakan hanya
 * oleh `status`. Tidak ada bentuk SELECT yang bisa mengambil salah satunya
 * tanpa yang lain tanpa menyaring per baris, dan menyaring per baris di SQL
 * berarti angka notanya tidak bisa lagi dijumlahkan ulang untuk memeriksa
 * kebenarannya. Yang dijamin di sini bukan "tidak pernah dibaca" melainkan
 * "tidak pernah masuk berkas", dan `susunNota()` yang menegakkannya.
 */
export async function rincianObatAktif(): Promise<boolean> {
  return getSettingBool(SETTING_RINCIAN_OBAT, false);
}

export async function bacaCatatanKakiDokumen(kop: Awaited<ReturnType<typeof bacaKopSurat>>): Promise<string> {
  return rakitCatatanKaki(await getSetting(SETTING_CATATAN_KAKI), kop);
}

/**
 * Satu jalur dari isi dokumen ke BERKAS PDF, dipakai pratinjau MAUPUN
 * pengiriman.
 *
 * PDF dan bukan bentuk lain, dan itu keputusan yang disengaja: dokumen ini
 * beredar sebagai PEGANGAN -- hasil pemeriksaan yang dibawa ke dokter lain,
 * nota yang jadi bukti bayar. Bentuk yang bisa disunting penerimanya membuat
 * angka hasil laboratorium dan nominal tagihan yang sudah berpindah tangan
 * berhenti bisa dijamin sama dengan yang diterbitkan rumah sakit, dan itu
 * persis jaminan yang membuat berkas ini ada gunanya.
 */
export async function dokumenKeBerkas(
  isi: IsiDokumen,
  opsi: OpsiRenderDokumen = {},
): Promise<{ isi: Buffer; mime: string }> {
  return { isi: await htmlKePdf(await dokumenKeHtml(isi, opsi)), mime: 'application/pdf' };
}

export interface OpsiRenderDokumen {
  /**
   * Isinya data karangan (`core/dokumenContoh.ts`) -- halamannya wajib
   * mengatakannya. Diteruskan apa adanya ke `renderDokumenHtml`; lihat
   * alasannya di sana.
   */
  contoh?: boolean;
}

/** Satu jalur dari isi dokumen ke HTML, dipakai pratinjau MAUPUN pengiriman. */
export async function dokumenKeHtml(isi: IsiDokumen, opsi: OpsiRenderDokumen = {}): Promise<string> {
  const kop = await bacaKopSurat();
  const [catatanKaki, qrDataUri] = await Promise.all([
    bacaCatatanKakiDokumen(kop),
    buatQrAsalUsul(teksAsalUsulDokumen(kop, isi.kepala)),
  ]);
  return renderDokumenHtml(isi, kop, { catatanKaki, qrDataUri, contoh: opsi.contoh });
}

/**
 * Isi dokumen KARANGAN untuk jenis yang belum pernah terjadi di Khanza.
 *
 * Tinggal di sini, bukan di rutenya, semata karena satu hal yang harus ikut:
 * `rincianObatAktif()`. Contoh nota yang mengabaikan sakelar itu memperlihatkan
 * bentuk yang BUKAN bentuk yang akan terkirim -- yaitu satu-satunya cacat yang
 * membuat sebuah pratinjau lebih buruk daripada tidak ada.
 */
export async function contohDokumenKarangan(jenis: JenisDokumen): Promise<IsiDokumen> {
  return contohIsiDokumen(jenis, {
    tanggal: tanggalLokal(new Date()),
    rincianObat: await rincianObatAktif(),
  });
}

/**
 * Kunci satu dokumen.
 *
 * Ketiganya berangkat dari kunjungan (`no_rawat`) tapi disempitkan berbeda:
 * hasil penunjang per TANGGAL PERIKSA (satu kunjungan bisa diperiksa dua hari
 * berturut-turut, dan pemicunya memang menggabungkan per hari), nota per
 * kunjungan karena `billing` memang satu himpunan per kunjungan.
 */
export type PermintaanDokumen =
  | { jenis: 'lab'; noRawat: string; tglPeriksa: string }
  | { jenis: 'radiologi'; noRawat: string; tglPeriksa: string }
  | { jenis: 'nota'; noRawat: string; noNota: string | null; tanggal: string | null; sumber: 'rajal' | 'ranap' };

/**
 * Membaca `sik` lalu menyusun isi dokumen.
 *
 * `null` berarti kunjungannya tidak ditemukan -- pemanggilnya lalu mengirim
 * pesan TANPA lampiran alih-alih menjatuhkan pemberitahuannya. Kabar "hasil
 * Anda sudah tersedia" tetap benar dan tetap berguna sekalipun berkasnya gagal
 * dirakit; menukar kabar yang benar dengan diam adalah pertukaran yang salah
 * arah.
 *
 * Isi yang KOSONG (nol parameter lab, nol baris nota) tetap menghasilkan
 * dokumen, bukan `null`. Dokumen yang mengatakan "belum ada parameter tercatat"
 * masih menjawab pertanyaan pasien; ketiadaan berkas tidak menjawab apa pun,
 * dan tidak bisa dibedakan dari fitur yang rusak.
 */
export async function muatDokumen(p: PermintaanDokumen): Promise<IsiDokumen | null> {
  const identitas = await ambilIdentitasKunjungan(p.noRawat);
  if (!identitas) return null;

  if (p.jenis === 'lab') {
    const baris = await ambilHasilLab(p.noRawat, p.tglPeriksa);
    return susunHasilLab(identitas, baris, p.tglPeriksa);
  }

  if (p.jenis === 'radiologi') {
    const { bacaan, pemeriksaan } = await ambilHasilRadiologi(p.noRawat, p.tglPeriksa);
    return susunHasilRadiologi(identitas, bacaan, pemeriksaan, p.tglPeriksa);
  }

  const { baris, pembayaran } = await ambilNota(p.noRawat, p.sumber);
  return susunNota(identitas, baris, pembayaran, p.noNota, p.tanggal, {
    rincianObat: await rincianObatAktif(),
  });
}

/**
 * Kejadian TERBARU dari satu jenis, sebagai permintaan dokumen siap pakai.
 *
 * Dipakai halaman DAN rute pratinjaunya -- yang pertama untuk tahu apakah
 * tombolnya perlu ditampilkan, yang kedua untuk benar-benar merendernya. Dua
 * penurunan untuk "contoh mana yang dipakai" berarti tombol yang mengaku ada
 * contohnya lalu membuka pratinjau kosong.
 *
 * `null` = belum ada satu pun kejadian jenis ini di Khanza. Keadaan itu HARUS
 * dibedakan dari "ada tapi gagal dirender" oleh pemanggilnya: yang pertama
 * berarti fiturnya belum akan menghasilkan apa-apa kalau dinyalakan sekarang,
 * yang kedua berarti ada yang rusak.
 */
export async function contohPermintaanDokumen(jenis: JenisDokumen): Promise<PermintaanDokumen | null> {
  const contoh = await ambilContohKejadian(jenis);
  if (!contoh) return null;

  if (jenis === 'nota') {
    // Contohnya selalu diambil dari `nota_jalan`: rawat inap belum pernah
    // dipakai di instalasi ini (`nota_inap` 0 baris), dan contoh yang diambil
    // dari tabel kosong tidak menghasilkan apa pun untuk dilihat.
    return { jenis, noRawat: contoh.no_rawat, noNota: contoh.no_nota ?? null, tanggal: contoh.tanggal, sumber: 'rajal' };
  }
  return { jenis, noRawat: contoh.no_rawat, tglPeriksa: contoh.tanggal };
}
