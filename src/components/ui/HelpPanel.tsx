'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IconInfo, IconX } from './icons';

/**
 * Satu pintu bantuan per halaman.
 *
 * ## Kenapa ini ada
 *
 * Diukur sebelum berkas ini dibuat: 83.948 karakter prosa di 766 blok tersebar
 * di seluruh dashboard, 32.039 di antaranya di `/farmasi` saja (21 `Callout` dan
 * 27 `Petunjuk` pada SATU halaman). Prosanya sendiri tidak salah -- halaman di
 * proyek ini memang sengaja menuliskan alasannya di depan staf, dan keputusan
 * itu dipertahankan. Yang salah adalah TEMPATNYA: keterangan yang dibaca sekali
 * seumur pemasangan duduk di jalur yang dilewati petugas puluhan kali sehari.
 *
 * Dua lintasan sebelumnya mencoba memperbaikinya dengan MELIPAT prosa
 * (`Callout collapsible`) lalu menyembunyikannya di balik ikon (`Petunjuk`).
 * Keduanya menurunkan angka tapi tidak menyelesaikan masalahnya, dan sebabnya
 * bisa disebut: prosa yang dilipat TETAP di halaman itu -- ia masih memakan satu
 * baris judul, masih memutus aliran antara satu kontrol dan kontrol berikutnya,
 * dan pada halaman yang punya belasan lipatan, deretan judul terlipat itu
 * sendiri menjadi kebisingan yang baru.
 *
 * Yang menyelesaikannya adalah memindahkan golongan itu KELUAR dari kanvas,
 * bukan mengecilkannya di dalam kanvas.
 *
 * ## Apa yang boleh masuk sini, dan apa yang TIDAK
 *
 * Ujinya satu kalimat, sama dengan yang sudah dipakai di seluruh proyek ini:
 * *kalau staf menekan kontrolnya tanpa membaca ini, apakah ada yang tidak bisa
 * ditarik kembali?*
 *
 * | | Isi | Tempatnya |
 * |---|---|---|
 * | **pagar** | dibaca SEBELUM tindakan tak terbalikkan | tetap `Callout` terbentang di halaman |
 * | **orientasi** | "halaman ini apa", "kenapa begini" | **di sini** |
 * | **rujukan** | "centang ini artinya apa" | `Petunjuk` di kontrolnya |
 *
 * **Peringatan yang menjaga data pasien atau sakelar tak terbalikkan TIDAK
 * boleh dipindah ke sini.** Memindahkannya menukar halaman yang lebih pendek
 * dengan keputusan yang diambil tanpa keterangan -- persis kerugian yang
 * `Callout` sudah menolaknya, dan alasan itu tidak berubah hanya karena
 * tempatnya sekarang lebih rapi.
 *
 * ## Bentuknya
 *
 * `<dialog>` asli, alasan yang sama persis dengan `Modal`: fokus terkurung, Esc
 * menutup, halaman di belakang inert, backdrop digambar peramban. Bedanya cuma
 * penempatan -- laci di tepi kanan, bukan kotak di tengah, karena isinya untuk
 * DIBACA sambil melihat halamannya, dan kotak di tengah menutupi justru kontrol
 * yang sedang ditanyakan.
 *
 * Isinya dirender di SERVER dan diserahkan sebagai `children`; yang klien cuma
 * buka-tutupnya. Jadi seluruh prosa tetap ada di HTML halaman -- bisa dicari
 * Ctrl+F, bisa dibaca pembaca layar, bisa diindeks -- hanya tidak tergambar
 * sampai diminta. Itu yang membedakannya dari menghapus prosa.
 */
export function HelpPanel({
  title = 'Tentang halaman ini',
  label = 'Bantuan',
  children,
}: {
  /** Judul laci. Sebutkan halamannya bila ada lebih dari satu pintu di satu rute. */
  title?: string;
  /** Teks tombolnya. Ikon SAJA tidak cukup -- lihat catatan di bawah. */
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const judulId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Dijaga dua arah, alasan sama dengan Modal: showModal() pada dialog yang
    // sudah terbuka melempar InvalidStateError.
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-label text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <IconInfo className="h-4 w-4" />
        {/* Label teks WAJIB ikut, bukan ikon telanjang: tombol yang cuma ikon
            "i" adalah bentuk yang paling sering tidak ditemukan orang yang
            justru membutuhkannya, dan di layar sentuh tidak ada hover yang bisa
            menjelaskannya. Disembunyikan hanya di layar paling sempit, tempat
            ruang barisnya memang tidak ada. */}
        <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{label}</span>
      </button>

      <dialog
        ref={ref}
        aria-labelledby={judulId}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="ml-auto mr-0 h-dvh max-h-dvh w-[calc(100vw-2rem)] max-w-lg border-l bg-card p-0 text-foreground shadow-lg backdrop:bg-black/50 sm:w-full"
      >
        <div className="flex h-dvh flex-col">
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <h2 id={judulId} className="text-title-sm">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup bantuan"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
          {/* `measure` membatasi panjang baris; tanpa itu prosa di laci selebar
              32rem masih terbaca, tapi di layar lebar laci ini boleh melar dan
              barisnya jadi terlalu panjang untuk mata mengikutinya. */}
          <div className="measure flex-1 space-y-4 overflow-y-auto px-5 py-4 text-prose text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * Satu bagian di dalam `HelpPanel`.
 *
 * Judulnya wajib: laci berisi enam paragraf tanpa judul adalah dokumen, dan
 * dokumen tidak dibaca sambil bekerja. Dengan judul, staf bisa melompat ke
 * bagian yang ditanyakannya tanpa membaca sisanya.
 */
export function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-label text-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
