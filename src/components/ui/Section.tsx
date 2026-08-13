import type { ReactNode } from 'react';

/**
 * Satu bagian berjudul, berikut jarak vertikalnya.
 *
 * ## Kenapa ini ada
 *
 * Sebelum ini tiap halaman merakit kepala bagiannya sendiri, dan hasilnya
 * terukur: `text-xs` 477 kali berbanding `text-sm` 186 kali, `font-medium` 474
 * kali berbanding `font-semibold` 13 kali. Artinya judul bagian dan keterangan
 * di bawahnya ditulis dengan ukuran DAN berat yang praktis sama -- jadi mata
 * tidak punya jangkar, dan halaman terbaca sebagai satu bidang abu-abu tanpa
 * pembacanya bisa menunjuk apa yang salah.
 *
 * Jarak antar bagian juga dipilih sendiri-sendiri (`mt-6`, `mt-8`, `space-y-4`,
 * `space-y-6` bercampur di berkas yang sama), sehingga dua bagian yang sederajat
 * bisa punya jarak berbeda dan pembacanya menyimpulkan hubungan yang tidak ada.
 *
 * Yang dijaga di sini karena itu BUKAN warna melainkan tiga hal yang lebih
 * menentukan: ukuran, berat, dan jarak.
 *
 * ## Tingkat jarak
 *
 * Mengikuti irama 4/8. Bukan pilihan bebas -- yang menentukan HUBUNGAN antar
 * blok adalah jaraknya, jadi tiga tingkat ini punya arti masing-masing:
 *
 * | | Jarak | Artinya |
 * |---|---|---|
 * | `rapat` | 16px | bagian di dalam satu kartu |
 * | `normal` | 24px | bagian sederajat di satu halaman |
 * | `longgar` | 40px | wilayah yang benar-benar berbeda urusannya |
 */
const JARAK = {
  rapat: 'mt-4',
  normal: 'mt-6',
  longgar: 'mt-10',
} as const;

export function Section({
  title,
  description,
  actions,
  children,
  jarak = 'normal',
  /**
   * Turunkan ke `h3` untuk bagian DI DALAM bagian. Urutan judul tidak boleh
   * melompat (h1 -> h3) -- pembaca layar memakainya untuk menavigasi halaman,
   * dan lompatan tingkat membuat strukturnya terbaca salah.
   */
  as: Heading = 'h2',
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  jarak?: keyof typeof JARAK;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  const ukuranJudul = Heading === 'h2' ? 'text-title' : 'text-title-sm';

  return (
    <section className={`${JARAK[jarak]} ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <Heading className={ukuranJudul}>{title}</Heading>}
            {/* `measure` membatasi baris ke ~68 karakter. Di monitor loket
                1920px, keterangan yang dibiarkan selebar halaman menghasilkan
                baris ~180 karakter -- mata kehilangan tempatnya saat kembali ke
                awal baris, dan kalimatnya berhenti terbaca justru karena
                ruangnya berlimpah. */}
            {description && (
              <p className="measure mt-1 text-body text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
