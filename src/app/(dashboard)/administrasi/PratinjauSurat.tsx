'use client';

import { useState } from 'react';
import { Button, LinkButton, Modal, Skeleton } from '@/components/ui';
import type { JenisSurat } from '@/core/suratDoc';

/**
 * Pratinjau surat di dalam dashboard, sebelum satu berkas pun berpindah.
 *
 * ==========================================================================
 * Kenapa MODAL berisi HTML, bukan tautan yang membuka PDF
 * ==========================================================================
 *
 * Bentuk sebelumnya adalah `<a target="_blank">` menuju PDF ber-header
 * `Content-Disposition: inline`. Header itu benar dan tetap dikirim, tapi ia
 * cuma PERMINTAAN: Chrome punya setelan "Download PDF files instead of
 * automatically opening them", dan begitu ia menyala tombol "Lihat" berubah
 * jadi mengunduh berkas alih-alih menampilkannya. Tidak ada header yang bisa
 * memaksanya, dan setelan itu tidak terlihat sama sekali dari sisi kita.
 *
 * Akibatnya bukan sekadar mengganggu: surat berisi nama, umur, dan alamat
 * pasien menumpuk di folder Unduhan komputer loket yang dipakai bergantian
 * banyak petugas -- justru bertentangan dengan alasan pratinjau ini ada.
 *
 * HTML dirender peramban mana pun tanpa syarat, dan ia BUKAN penurunan kedua
 * di samping PDF melainkan bahannya (`suratKeHtml` -> `htmlKePdf`). Jadi
 * pratinjau ini satu langkah lebih dekat ke sumber, bukan lebih jauh -- syarat
 * yang sama yang membuat `previewUniqueCodeFooter()` memakai fungsi produksi.
 *
 * ==========================================================================
 * Tiga hal yang menempel
 * ==========================================================================
 *
 * 1. **SATU modal untuk seluruh tabel, dan `src` hanya terpasang saat
 *    terbuka.** Satu `<iframe>` per baris akan menembak route ini sebanyak
 *    baris yang tampil, dan tiap tembakan itu satu query ke `sik` -- kolam
 *    yang sengaja dibatasi `pool.max: 2` supaya tidak berebut dengan SIMRS
 *    yang sedang melayani pasien.
 *
 * 2. **Lebarnya dipaku 794 px (A4 pada 96 dpi), digulir menyamping bila
 *    layarnya sempit.** Membiarkannya melar mengikuti modal akan mengubah
 *    pemenggalan baris, sehingga yang dilihat staf bukan lagi susunan yang
 *    akan diterima pasien. Yang boleh menggulir kotaknya sendiri, bukan badan
 *    halaman.
 *
 * 3. **`sandbox` walau isinya sudah dilolos di `core/suratHtml.ts`.** Route-nya
 *    juga mengirim CSP `sandbox`; keduanya cadangan atas pelolosan itu, bukan
 *    penggantinya. Nama pasien adalah ketikan bebas petugas pendaftaran, dan
 *    sejak pratinjau ini ada, HTML surat sampai ke peramban petugas -- bukan
 *    lagi cuma ke Chromium pencetak PDF.
 */

export interface SasaranPratinjau {
  kunci: string;
  namaPasien: string;
  noRm: string;
}

export function PratinjauSurat({
  jenis,
  sasaran,
  onClose,
  onKirim,
  terkunci,
  alasanTerkunci,
  sedangKirim,
  galat,
}: {
  jenis: JenisSurat;
  /** null = tertutup. Barisnya ikut dibawa supaya judulnya menyebut pasiennya. */
  sasaran: SasaranPratinjau | null;
  onClose: () => void;
  onKirim: () => void;
  terkunci: boolean;
  alasanTerkunci?: string;
  sedangKirim: boolean;
  /**
   * Kegagalan kirim WAJIB tampil di sini, bukan cuma di baris tabelnya:
   * `<dialog>` yang terbuka membuat seluruh halaman di belakangnya inert, jadi
   * pesan di baris tabel ada di layar tapi tertutup backdrop. Yang terlihat
   * staf hanyalah tombol yang ditekan lalu tidak terjadi apa-apa.
   */
  galat?: string;
}) {
  const [siap, setSiap] = useState(false);

  const alamat = sasaran
    ? `/administrasi/pratinjau?jenis=${jenis}&kunci=${encodeURIComponent(sasaran.kunci)}`
    : '';

  return (
    <Modal
      open={!!sasaran}
      onClose={onClose}
      size="xl"
      title={sasaran ? `Pratinjau: ${sasaran.namaPasien}` : 'Pratinjau'}
      description={
        sasaran
          ? `RM ${sasaran.noRm} · ${sasaran.kunci} — periksa isinya sebelum berkasnya dikirim ke pasien.`
          : undefined
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-lg border bg-white">
          {/* Kotak setinggi A4 dipasang di sini, bukan di iframe-nya, supaya
              rangka pratinjau tidak berubah tinggi saat isinya selesai dimuat
              -- pergeseran tata letak tepat saat orang mulai membaca. */}
          <div className="relative mx-auto h-[70vh] w-[794px]">
            {!siap && (
              <div className="absolute inset-0 space-y-3 p-10">
                <Skeleton className="mx-auto h-5 w-2/3" />
                <Skeleton className="mx-auto h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            )}
            {sasaran && (
              <iframe
                // Memaksa iframe baru tiap kali barisnya berganti: tanpa key,
                // React memakai ulang elemen yang sama dan `siap` sempat
                // bernilai true sementara isinya masih surat pasien SEBELUMNYA.
                key={sasaran.kunci}
                src={alamat}
                onLoad={() => setSiap(true)}
                title={`Surat keterangan ${jenis} untuk ${sasaran.namaPasien}`}
                sandbox=""
                className={`h-full w-full transition-opacity ${siap ? 'opacity-100' : 'opacity-0'}`}
              />
            )}
          </div>
        </div>

        {galat && <p className="text-sm text-destructive">{galat}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Berkas sungguhannya tetap bisa dibuka -- yang kadang perlu
              dibuktikan justru PDF-nya, termasuk pemenggalan halamannya.
              Peramban boleh saja mengunduhnya alih-alih menampilkan, dan itu
              wajar untuk tombol yang memang bernama "berkas PDF". */}
          <LinkButton
            href={`${alamat}&format=pdf`}
            target="_blank"
            rel="noopener"
            prefetch={false}
            className="mr-auto"
          >
            Buka berkas PDF
          </LinkButton>
          <Button onClick={onClose}>Tutup</Button>
          <Button
            variant="primary"
            onClick={onKirim}
            disabled={terkunci || sedangKirim}
            title={alasanTerkunci}
          >
            {sedangKirim ? 'Mengirim...' : 'Kirim ke pasien'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
