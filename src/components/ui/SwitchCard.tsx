import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { IconAlertTriangle, IconCheck } from './icons';

/**
 * Kartu sakelar fitur: ikon keadaan + judul + lencana + keterangan + tombol.
 *
 * Bentuknya sudah dipakai tiga belas kali di lima halaman -- kesembilan sakelar
 * `/farmasi`, plus `/administrasi`, `/balasan-otomatis`, `/bpjs`, dan `/erm` --
 * dan sampai berkas ini ada, ketiga belasnya menyalin kerangka JSX yang sama
 * kata demi kata. Tiga belas salinan berarti tiga belas kesempatan menyimpang,
 * dan yang menyimpang di sini tidak menghasilkan galat: cuma satu halaman yang
 * kartunya berperilaku lain dari dua belas lainnya. Bentuk kegagalan yang sudah
 * berkali-kali dibayar di proyek ini (`respectsOptOut()`, `core/outboxStatus.ts`,
 * `kunciPesanMasuk()`, `core/tujuanPemicu.ts`, `SCHEDULE_ACTOR`).
 *
 * ==========================================================================
 * BISA DILIPAT, tapi TERBENTANG secara bawaan
 * ==========================================================================
 *
 * Keduanya perlu, dan keduanya menjawab keberatan yang berbeda.
 *
 * Bisa dilipat, karena kartu ini memuat tiga sampai lima paragraf sementara
 * yang dicari orang yang sudah paham fiturnya cuma dua hal: menyala atau mati,
 * dan tombolnya. `/farmasi` memuat sembilan kartu semacam ini; terbentang
 * semua, halamannya menjadi gulungan panjang yang justru berhenti dibaca.
 *
 * Terbentang secara bawaan, karena isinya BUKAN sekadar keterangan. Di dalamnya
 * ada peringatan yang menentukan keputusan dan tidak bisa ditarik kembali:
 * lantai aktivasi yang permanen, laju 16-46 nota per hari, dan "sakelarnya
 * menyala tapi belum ada tujuan yang mencentang" -- yang terakhir adalah
 * keadaan salah setel yang gejalanya persis sama dengan keadaan benar (halaman
 * wajar, nol pesan keluar). Melipatnya secara bawaan menukar halaman yang lebih
 * pendek dengan keputusan yang diambil tanpa keterangan, dan itu justru yang
 * `Callout` sudah putuskan untuk TIDAK dilakukan pada pagar.
 *
 * Jadi yang ditambahkan adalah KEMAMPUAN melipat, bukan pelipatan itu sendiri.
 * Staf yang sudah hafal bisa menutupnya; yang baru pertama kali tetap membaca
 * seluruhnya tanpa menekan apa pun.
 *
 * `<details>` asli, bukan state React: nol JavaScript, bisa keyboard, dan
 * peramban membukanya sendiri saat isinya kena Ctrl+F -- alasan yang sama yang
 * membuat `Callout` memakainya.
 */
export interface SwitchCardProps {
  /** Menentukan warna, ikon, dan lencana sekaligus. */
  enabled: boolean;
  judul: ReactNode;
  /** Tombol nyalakan/matikan. Sengaja DI LUAR `<summary>` -- kontrol di dalam
   *  summary akan ikut membuka-tutup panelnya saat ditekan. */
  aksi?: ReactNode;
  children: ReactNode;
  labelAktif?: string;
  labelMati?: string;
  defaultOpen?: boolean;
  /**
   * `utama` untuk sakelar induk sebuah halaman (judul `h2`), `biasa` untuk
   * sakelar per-fitur di bawahnya (`h3`). Tingkat heading-nya ikut berubah,
   * bukan cuma ukurannya -- pembaca layar menelusuri halaman lewat urutan
   * heading, dan sakelar induk yang ditandai `h3` membuat sembilan sakelar
   * `/farmasi` terbaca sederajat dengan yang menaungi mereka.
   */
  tingkat?: 'utama' | 'biasa';
  /**
   * Jarak bawah SENGAJA tidak dibawa komponen ini. Dua utility Tailwind untuk
   * properti yang sama (`mb-4` bawaan vs `mb-6` dari pemanggil) menang menurut
   * urutan Tailwind menghasilkan CSS-nya, bukan urutan penulisannya -- jadi
   * override-nya bisa diam-diam KALAH. Aturan yang sama sudah tertulis di
   * `Button`/`Input`: yang boleh lewat `className` cuma properti yang tidak
   * pernah ditetapkan komponennya sendiri.
   */
  className?: string;
}

export function SwitchCard({
  enabled,
  judul,
  aksi,
  children,
  labelAktif = 'Menyala',
  labelMati = 'Mati',
  defaultOpen = true,
  tingkat = 'biasa',
  className = '',
}: SwitchCardProps) {
  const Judul = tingkat === 'utama' ? 'h2' : 'h3';
  const gayaJudul = tingkat === 'utama' ? 'text-title' : 'text-title-sm';

  return (
    <section
      className={`rounded-lg border p-4 ${
        enabled ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
      } ${className}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* `<details>` membungkus kolom KIRI saja, sehingga tombolnya tetap
            bersaudara dengannya dan tidak ikut tersembunyi saat dilipat --
            tepat kebalikan dari yang dibutuhkan: yang paling sering dicari
            justru tombolnya. */}
        <details className="min-w-0 flex-1" open={defaultOpen}>
          {/* `<summary>` sengaja TIDAK dijadikan flex: di Chromium itu
              menghapus segitiga pembukanya, sehingga satu-satunya tanda bahwa
              kartu ini bisa dilipat ikut hilang. Perataannya dikerjakan span di
              dalamnya -- pelajaran yang sama sudah dibayar di `Callout`. */}
          <summary className="cursor-pointer marker:text-muted-foreground">
            <span className="inline-flex flex-wrap items-center gap-2 align-middle">
              <span className={enabled ? 'text-success' : 'text-warning'}>
                {enabled ? <IconCheck className="h-5 w-5" /> : <IconAlertTriangle className="h-5 w-5" />}
              </span>
              <Judul className={gayaJudul}>{judul}</Judul>
              <Badge variant={enabled ? 'success' : 'warning'}>{enabled ? labelAktif : labelMati}</Badge>
            </span>
          </summary>
          {/* Digeser sejajar dengan TEKS judul (1.25rem ikon + 0.5rem jarak),
              bukan dengan ikonnya -- tanpa itu paragrafnya mulai dari tepi
              kartu sementara judulnya menjorok, dan keduanya berhenti terbaca
              sebagai satu blok. */}
          <div className="mt-2 pl-7">{children}</div>
        </details>
        {aksi}
      </div>
    </section>
  );
}
