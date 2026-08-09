import { simpanPdfSurat } from '@/lib/mediaStorage';
import { periksaPanjangKeterangan } from '@/core/media';
import { namaBerkasDokumen, type JenisDokumen } from '@/core/dokumenDoc';
import { dokumenKeBerkas, muatDokumen, type PermintaanDokumen } from '@/lib/dokumen';
import { previewUniqueCodeFooter } from './pipeline';
import { logger, safeError } from '@/lib/logger';

/**
 * Merender satu dokumen hasil jadi PDF lalu menaruhnya di penyimpanan media --
 * lampiran opsional untuk `LAB_RESULT`, `RAD_RESULT`, dan `BILLING_READY`
 * (migrations/038).
 *
 * ==========================================================================
 * GAGAL = PERILAKU LAMA, bukan pesan yang hilang
 * ==========================================================================
 *
 * Setiap kegagalan di sini menghasilkan `null`, dan pemanggilnya lalu mengirim
 * pesan APA ADANYA dari `template.body` -- persis seperti sebelum fitur ini
 * ada. Itu keputusan yang membedakannya dari `worker/suratRunner.ts`, yang
 * memilih menghentikan siklusnya.
 *
 * Bedanya bukan selera melainkan bentuk fiturnya: di sana berkas ITULAH
 * pesannya, jadi tanpa berkas tidak ada yang bisa dikirim. Di sini pesannya
 * sudah berdiri sendiri dan sudah berguna sejak Fase 1 -- "hasil pemeriksaan
 * Anda sudah tersedia" tetap benar dan tetap menolong sekalipun PDF-nya gagal
 * dirakit. Menjatuhkan pemberitahuan yang sudah berjalan karena tempelan
 * opsionalnya bermasalah adalah kemunduran yang disebabkan oleh fitur
 * tambahan, dan itu arah yang salah.
 *
 * Akibat yang HARUS disadari: kunci idempoten barisnya ikut terpakai, jadi
 * dokumen untuk kejadian itu tidak akan dicoba lagi otomatis. Yang hilang cuma
 * lampirannya, dan pasien tetap bisa mengambilnya di rumah sakit -- kalimat
 * yang memang ada di badan template aslinya.
 */

export interface LampiranDokumen {
  media: { path: string; mime: string; name: string };
  body: string;
}

export async function siapkanLampiranDokumen(
  permintaan: PermintaanDokumen,
  pesanPengantar: string,
  seedKodeUnik: string,
): Promise<LampiranDokumen | null> {
  const jenis: JenisDokumen = permintaan.jenis;

  try {
    /**
     * Batas 1.024 karakter berlaku KARENA ada lampiran: begitu sebuah pesan
     * membawa berkas, isinya menjadi *caption* dan tunduk pada batas yang jauh
     * lebih pendek daripada pesan teks biasa (core/media.ts).
     *
     * Diperiksa PALING DEPAN, sebelum `sik` disentuh dan sebelum Chromium
     * menyala. Ini kesalahan setelan yang mengenai SEMUA dokumen jenis ini
     * sekaligus, jadi merender lebih dulu berarti membuang satu peluncuran
     * peramban per pasien untuk berkas yang sudah pasti tidak jadi dikirim.
     */
    const footer = await previewUniqueCodeFooter(seedKodeUnik);
    const cek = periksaPanjangKeterangan(pesanPengantar, footer ? footer.length + 2 : 0);
    if (!cek.ok) {
      logger.warn(
        { jenis, panjang: pesanPengantar.length, alasan: cek.error },
        'pesan pengantar dokumen terlalu panjang untuk jadi keterangan lampiran, dikirim tanpa berkas',
      );
      return null;
    }

    const isi = await muatDokumen(permintaan);
    if (!isi) {
      logger.warn({ jenis, noRawat: permintaan.noRawat }, 'kunjungan tidak ditemukan, dokumen tidak dilampirkan');
      return null;
    }

    const berkas = await dokumenKeBerkas(isi);
    const path = await simpanPdfSurat(berkas.isi);

    logger.info(
      { jenis, noRawat: permintaan.noRawat, bytes: berkas.isi.byteLength },
      'dokumen hasil siap dilampirkan',
    );

    return {
      media: {
        path,
        mime: berkas.mime,
        // Nama berkas TIDAK memuat nama pasien -- lihat `namaBerkasDokumen()`.
        name: namaBerkasDokumen(jenis, isi.kepala.tanggalRingkas ? tanggalIso(isi.kepala.tanggalRingkas) : null),
      },
      body: pesanPengantar,
    };
  } catch (err) {
    logger.error(
      { jenis, noRawat: permintaan.noRawat, ...safeError(err) },
      'gagal merender dokumen hasil, pesan tetap dikirim tanpa lampiran',
    );
    return null;
  }
}

/**
 * "08-08-2026" -> "2026-08-08".
 *
 * `KepalaDokumen` menyimpan bentuk ringkas karena itu yang dibutuhkan QR;
 * `namaBerkasDokumen()` menerima bentuk ISO karena itu bentuk yang dipakai
 * seluruh proyek. Dibalik di sini alih-alih menambah medan ketiga ke
 * `KepalaDokumen`, supaya tidak ada dua tanggal yang bisa menyimpang.
 */
function tanggalIso(ringkas: string): string | null {
  const cocok = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ringkas);
  return cocok ? `${cocok[3]}-${cocok[2]}-${cocok[1]}` : null;
}
