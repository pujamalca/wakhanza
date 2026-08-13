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
  /** Melipat isinya di balik judul. Judul tetap selalu terlihat. */
  collapsible?: boolean;
  /** Hanya berlaku bila `collapsible`. */
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

  if (!collapsible) {
    return (
      <div className={kotak}>
        <p className="font-medium">{judul}</p>
        <div className={`measure mt-1 text-muted-foreground ${jarakIsi}`}>{children}</div>
      </div>
    );
  }

  return (
    // `<summary>` sengaja TIDAK dijadikan flex: di Chromium itu menghapus
    // segitiga pembukanya, sehingga satu-satunya tanda bahwa kotak ini bisa
    // dibuka ikut hilang. Perataannya dikerjakan span di dalamnya.
    <details className={kotak} open={defaultOpen}>
      <summary className="cursor-pointer font-medium marker:text-muted-foreground">{judul}</summary>
      <div className={`measure mt-2 text-muted-foreground ${jarakIsi}`}>{children}</div>
    </details>
  );
}
