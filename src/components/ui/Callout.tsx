import type { ComponentType, ReactNode } from 'react';
import { IconAlertTriangle, IconInfo, IconShield, type IconProps } from './icons';

/**
 * Kotak keterangan berjudul, dengan pilihan dilipat.
 *
 * Halaman di proyek ini sengaja menuliskan ALASAN di depan staf, bukan cuma di
 * komentar kode -- itu keputusan yang dipertahankan. Tapi prosa yang selalu
 * terbentang penuh punya ongkosnya sendiri: empat paragraf sebelum kontrol
 * pertama membuat halaman digulir jauh, dan yang digulir cepat justru berhenti
 * dibaca. Persis pola yang sama dengan peringatan harian berisi "tidak ada
 * apa-apa" yang berhenti dibaca dalam seminggu.
 *
 * Bentuk melipatnya lewat `<details>` asli: nol JavaScript, bisa dibuka dengan
 * keyboard, dan peramban modern membukanya sendiri saat isinya kena Ctrl+F.
 *
 * ## Syarat yang mengikat
 *
 * **`title` harus utuh sendirian.** Yang selalu terlihat cuma judulnya, jadi
 * judul yang berbunyi "Catatan" atau "Info penting" menyembunyikan seluruh
 * pesannya di balik satu klik yang tidak ada alasan untuk ditekan. Judul memuat
 * KESIMPULANNYA ("Pesan ini berisi data pasien"), isinya memuat ALASANNYA.
 *
 * Karena itu peringatan yang harus dibaca sebelum sebuah sakelar dinyalakan
 * dibiarkan terbentang (`defaultOpen`), bukan dilipat -- melipatnya menukar
 * halaman yang lebih pendek dengan keputusan yang diambil tanpa keterangan.
 */

/**
 * ## Ikon jangkar
 *
 * Tiap varian membawa satu ikon di depan judulnya. Ia **bukan pengganti** prosa
 * -- justru kebalikannya: peringatan yang harus dibaca sebelum sebuah sakelar
 * dinyalakan tetap terbentang penuh, dan ikonnya ada supaya pagar itu bisa
 * ditemukan sekilas di halaman yang memuat belasan kotak keterangan. Keterangan
 * yang memang boleh disembunyikan pindah ke `Petunjuk`, bukan ke sini.
 *
 * `privasi` sengaja berbagi warna dengan `warning`: keduanya sama-sama pagar,
 * yang berbeda JENISNYA -- satu memperingatkan akibat, satu memperingatkan data
 * siapa yang beredar. Di halaman yang memuat keduanya (mis. `/farmasi`)
 * pembedaan itulah yang membuat keduanya bisa dipisahkan tanpa dibaca dulu.
 *
 * Ikonnya `aria-hidden` (bawaan `icons.tsx`) karena judulnya sudah membawa
 * seluruh maknanya sebagai teks -- ikon yang ikut dibacakan pembaca layar cuma
 * menggandakan kalimat yang sama.
 */
export type CalloutVariant = 'warning' | 'privasi' | 'info' | 'neutral';

const KOTAK: Record<CalloutVariant, string> = {
  warning: 'border-warning/30 bg-warning/5',
  privasi: 'border-warning/30 bg-warning/5',
  // Biru `--info`, BUKAN `--primary` seperti sebelumnya. Kotak yang cuma
  // menerangkan sesuatu dan tombol yang minta ditekan adalah dua peran yang
  // berlawanan; memberi keduanya warna merek yang sama membuat halaman penuh
  // bidang hijau yang tidak satu pun bisa ditebak gunanya sebelum dibaca.
  info: 'border-info/25 bg-info/5',
  neutral: 'border-border/60 bg-surface-sunken',
};

const IKON: Record<CalloutVariant, ComponentType<IconProps> | null> = {
  warning: IconAlertTriangle,
  privasi: IconShield,
  info: IconInfo,
  // Catatan biasa tidak dapat ikon: pada varian yang paling sering dipakai, ikon
  // berhenti menandai apa pun dan cuma menambah satu bidang gambar per kotak.
  neutral: null,
};

const WARNA_IKON: Record<CalloutVariant, string> = {
  warning: 'text-warning',
  privasi: 'text-warning',
  info: 'text-info',
  neutral: '',
};

export interface CalloutProps {
  variant?: CalloutVariant;
  title: ReactNode;
  children?: ReactNode;
  /**
   * Mulai dalam keadaan TERLIPAT. Melipatnya sendiri selalu bisa dilakukan --
   * lihat catatan di bawah; yang diatur prop ini cuma keadaan awalnya.
   */
  collapsible?: boolean;
  /** Membentangkan kotak yang `collapsible`. */
  defaultOpen?: boolean;
  className?: string;
}

export function Callout({
  variant = 'neutral',
  title,
  children,
  collapsible = false,
  defaultOpen = false,
  className = '',
}: CalloutProps) {
  // `text-prose` (14px/1.7), bukan `text-xs` (12px/1.5) seperti sebelumnya.
  // Kotak ini berisi KALIMAT, dan 12px adalah ukuran untuk metadata -- stempel
  // waktu, kode mesin. Menaruh paragraf di sana membuatnya terbaca sebagai
  // catatan kaki yang boleh dilewati, yang persis kebalikan dari gunanya pada
  // varian `warning`/`privasi`.
  const kotak = `rounded-lg border p-3 text-prose ${KOTAK[variant]} ${className}`;
  const Ikon = IKON[variant];

  /**
   * Isinya digeser sejajar dengan TEKS judul, bukan dengan ikonnya: 1rem lebar
   * ikon + 0.5rem jarak. Tanpa itu, paragraf di bawah mulai dari tepi kotak
   * sementara judulnya menjorok, dan keduanya berhenti terbaca sebagai satu
   * blok yang sama.
   */
  const jarakIsi = Ikon ? 'ml-6' : '';

  const judul = (
    <span className="inline-flex items-start gap-2 align-top">
      {/* `aria-hidden` datang dari `icons.tsx` -- judulnya sudah membawa seluruh
          maknanya sebagai teks, jadi ikon yang ikut dibacakan pembaca layar cuma
          menggandakan kalimat yang sama. */}
      {Ikon && <Ikon className={`h-4 w-4 shrink-0 ${WARNA_IKON[variant]}`} />}
      <span>{title}</span>
    </span>
  );

  if (!children) return <div className={kotak}><span className="font-medium">{judul}</span></div>;

  /**
   * SELALU `<details>`, tidak pernah lagi `<div>` mati.
   *
   * Sebelumnya kotak yang tidak ditandai `collapsible` sama sekali tidak bisa
   * dilipat, dan di halaman seperti `/farmasi` -- yang memuat belasan kotak
   * keterangan panjang -- itu berarti staf yang sudah hafal isinya tetap harus
   * menggulir melewati seluruhnya, tiap kali. Kemampuan melipat tidak
   * menyembunyikan apa pun dengan sendirinya; yang menyembunyikan adalah
   * keadaan AWAL, dan itu tetap diputuskan pemanggil.
   *
   * Karena itu bawaannya terbentang: kotak yang selama ini selalu terlihat
   * TETAP terlihat setelah perubahan ini, cuma kini punya segitiga untuk
   * ditutup. Yang sudah menandai dirinya `collapsible` tetap mulai terlipat
   * seperti sebelumnya. Nol perubahan pada apa yang terbaca saat halaman
   * dibuka -- yang bertambah cuma pilihannya.
   */
  return (
    // `<summary>` sengaja TIDAK dijadikan flex: di Chromium itu menghapus
    // segitiga pembukanya, sehingga satu-satunya tanda bahwa kotak ini bisa
    // dibuka ikut hilang. Perataannya dikerjakan span di dalamnya.
    <details className={kotak} open={!collapsible || defaultOpen}>
      <summary className="cursor-pointer font-medium marker:text-muted-foreground">{judul}</summary>
      {/* TANPA `measure`. Aturan 68ch benar untuk prosa yang berdiri sendiri di
          atas latar halaman, dan salah di dalam kotak berbingkai: bingkainya
          merentang penuh sementara teksnya berhenti di tengah, sehingga yang
          terlihat bukan baris yang enak dibaca melainkan kotak yang separuhnya
          kosong -- apalagi bersebelahan dengan kartu sakelar yang prosanya
          memang penuh. Panjang barisnya kini dibatasi lebar kotaknya sendiri. */}
      <div className={`mt-2 text-muted-foreground ${jarakIsi}`}>{children}</div>
    </details>
  );
}
