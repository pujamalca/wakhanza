'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Kotak bergulir untuk lini masa percakapan.
 *
 * Tanpa ini, percakapan panjang memanjangkan HALAMANNYA: kotak balasan terdorong
 * jauh ke bawah, dan membalas menuntut menggulir seluruh riwayat lebih dulu --
 * tiap kali. Yang dibutuhkan kebalikannya: riwayatnya yang bergulir, sementara
 * judul di atas dan kotak balasan di bawah tetap di tempatnya.
 *
 * ==========================================================================
 * Kenapa perlu JavaScript sama sekali
 * ==========================================================================
 *
 * Urutannya NAIK (terbaru di bawah), jadi kotak yang baru dimuat memperlihatkan
 * pesan paling LAMA -- kebalikan dari yang dicari orang yang baru membukanya.
 * Menggulir ke bawah saat dimuat tidak punya padanan CSS.
 *
 * Ada satu jalan tanpa JavaScript: `flex-direction: column-reverse`, yang
 * membuat peramban menambatkan gulungan di bawah. DITOLAK, karena ia menuntut
 * urutan DOM-nya ikut dibalik -- dan pembaca layar membaca urutan DOM, sehingga
 * percakapannya terbaca dari yang terbaru ke yang terlama. Menukar keterbacaan
 * bagi yang paling bergantung padanya demi menghemat satu `useEffect` adalah
 * pertukaran yang sama yang sudah ditolak saat `Tabs` dibuat `<nav>` alih-alih
 * `role="tablist"`.
 *
 * `penanda` ada supaya ia menggulir LAGI sesudah balasan terkirim: halaman
 * disegarkan lewat `revalidatePath`, dan komponen ini tidak ikut dipasang ulang
 * -- efek tanpa kebergantungan hanya akan berjalan sekali, sehingga balasan yang
 * baru dikirim mendarat di luar layar. Diisi jumlah barisnya, satu-satunya hal
 * di sini yang pasti berubah saat ada pesan baru.
 */
export function KotakGulung({ penanda, children }: { penanda: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [penanda]);

  return (
    <div
      ref={ref}
      /**
       * `60vh` supaya tingginya mengikuti layar -- di monitor loket ia lega, di
       * laptop kecil ia tidak menelan seluruh halaman. Sengaja `max-h` dan
       * bukan `h`: percakapan pendek menyusut mengikuti isinya alih-alih
       * menyisakan bidang kosong tinggi di atas kotak balasan.
       */
      className="max-h-[60vh] space-y-2 overflow-y-auto rounded-lg border bg-surface-sunken p-3"
    >
      {children}
    </div>
  );
}
