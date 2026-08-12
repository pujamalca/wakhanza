'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';
import { IconInfo } from './icons';

/**
 * Keterangan pendek di balik satu ikon, untuk hal yang hanya perlu dibaca saat
 * tangan sedang menyentuh kontrolnya.
 *
 * ## Kenapa ini ada, dan kenapa BUKAN untuk semua keterangan
 *
 * Halaman di proyek ini menuliskan ALASAN di depan staf, dan itu dipertahankan.
 * Tapi ikon tidak membawa makna -- sebuah lingkaran-i berkata "ada sesuatu di
 * sini", bukan APA. Karena itu bentuk ini hanya dipakai untuk keterangan yang
 * lulus satu uji: **kalau staf menekan kontrolnya tanpa membaca ini, tidak ada
 * yang tidak bisa ditarik kembali.** Peringatan yang gagal uji itu tetap
 * terbentang sebagai `Callout`, karena melipatnya menukar halaman yang lebih
 * pendek dengan keputusan yang diambil tanpa keterangan.
 *
 * Yang digantikannya bukan prosa yang terbentang, melainkan atribut `title=`
 * berisi kalimat -- bentuk yang sudah dipakai di beberapa tempat dan yang
 * **tidak pernah muncul di layar sentuh sama sekali**, tidak bisa dibuka
 * keyboard, dan tidak diandalkan pembaca layar.
 *
 * ## Kenapa popover NATIVE, bukan div ber-`position:absolute`
 *
 * Keterangan semacam ini hampir selalu muncul di dalam tabel, dan
 * `tableWrapperClass` berbunyi `overflow-x-auto`. Begitu satu sumbu bukan
 * `visible`, sumbu satunya ikut jadi `auto` -- jadi tooltip yang diposisikan CSS
 * biasa TERGUNTING di sana. Diukur dengan hit-test `elementFromPoint` (bukan
 * `getBoundingClientRect`, yang tetap melaporkan posisi tata letak walau
 * pikselnya tidak pernah dilukis):
 *
 *   position:absolute  -> tidak terlihat di luar pembungkus, DAN melahirkan
 *                         scrollbar vertikal pada tabelnya
 *   popover + anchor   -> terlihat utuh, tanpa scrollbar
 *
 * Gratis dari peramban, dan itu sebabnya bukan komponen buatan sendiri: top
 * layer, Esc menutup, klik di luar menutup, satu popover terbuka pada satu
 * waktu. Nol baris JavaScript -- pola yang sama dengan `<dialog>` pada `Modal`
 * dan `<details>` pada `Callout`.
 *
 * ## Biaya yang diterima sadar-sadar
 *
 * Isi popover yang tertutup ber-`display:none`, jadi **tidak terjangkau Ctrl+F**.
 * Tidak ada cara menutupnya -- itu sifat top layer. Yang menahan kerugiannya:
 * peringatan pagar tidak pernah dipindahkan ke sini, dan keterangan yang
 * dilipat wajib menyisakan KESIMPULANNYA sebagai teks biasa. Yang lepas dari
 * jangkauan Ctrl+F cuma alasannya, tidak pernah kesimpulannya.
 */
export interface PetunjukProps {
  /**
   * SUBJEKNYA, bukan kata "info".
   *
   * Inilah yang dibacakan pembaca layar, dan "Keterangan" sendirian tidak
   * menyebut keterangan tentang APA -- di dalam tabel berisi enam ikon serupa,
   * label semacam itu membuat keenamnya tidak bisa dibedakan sama sekali.
   */
  untuk: string;
  children: ReactNode;
  /** Kelas tambahan untuk pembungkusnya saja (jarak, perataan). */
  className?: string;
}

export function Petunjuk({ untuk, children, className = '' }: PetunjukProps) {
  // `useId()` memuat karakter yang bukan ident CSS yang sah (dan bukan pula id
  // HTML yang nyaman), jadi disaring lebih dulu -- nilainya dipakai DUA kali:
  // sebagai target popover dan sebagai nama jangkar CSS.
  const id = `pt${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const jangkar = `--${id}`;

  return (
    <span className={`petunjuk ${className}`} style={{ '--jangkar': jangkar } as CSSProperties}>
      <button
        type="button"
        popoverTarget={id}
        aria-label={`Keterangan: ${untuk}`}
        className="petunjuk-tombol"
        style={{ anchorName: jangkar } as CSSProperties}
      >
        <IconInfo className="h-3.5 w-3.5" />
      </button>
      <div id={id} popover="auto" className="petunjuk-isi">
        {children}
      </div>
    </span>
  );
}
