import type { Config } from 'tailwindcss';

/**
 * Skala di berkas ini adalah PERAN, bukan angka telanjang.
 *
 * Sebelum design system ini ada, seluruh dashboard diukur dan hasilnya:
 * `text-xs` 477 kali, `text-sm` 186 kali, sisanya 7 kali -- jadi 97% teks hidup
 * di dua ukuran dan badan teksnya 12px. Bobotnya lebih timpang lagi:
 * `font-medium` 474 kali berbanding `font-semibold` 13 kali. Judul dan
 * keterangan karena itu punya ukuran DAN berat yang praktis sama, sehingga tidak
 * ada yang memimpin dan tidak ada yang mundur -- itulah sebab mekanis halaman
 * terbaca sebagai dinding abu-abu, bukan banyaknya prosa semata.
 *
 * Menambah `text-[13px]` di sana-sini tidak menyembuhkan itu; yang menyembuhkan
 * adalah tangga yang namanya menyebut PERANNYA, sehingga "ini judul bagian"
 * tidak bisa ditulis dengan ukuran badan teks tanpa terlihat salah saat dibaca
 * ulang.
 *
 * Ditaruh di `extend`, jadi `text-xs`/`text-sm` bawaan Tailwind TETAP ada --
 * 663 pemakaian yang sudah jalan tidak berubah artinya, dan perpindahannya bisa
 * dikerjakan per halaman alih-alih sebagai satu commit raksasa yang mustahil
 * ditinjau.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Diisi next/font di layout.tsx. Fallback-nya tetap tumpukan sistem,
        // jadi kegagalan memuat font menghasilkan halaman yang wajar -- bukan
        // teks tak terlihat (FOIT).
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        /** Judul halaman. Satu per halaman, pasangan `<h1>`. */
        display: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
        /** Judul bagian, pasangan `<h2>`. */
        title: ['1.125rem', { lineHeight: '1.35', letterSpacing: '-0.005em', fontWeight: '600' }],
        /** Judul kartu/sub-bagian, pasangan `<h3>`. */
        'title-sm': ['0.9375rem', { lineHeight: '1.4', fontWeight: '600' }],
        /** Badan teks antarmuka. Ini yang menggantikan `text-xs` sebagai bawaan. */
        body: ['0.875rem', { lineHeight: '1.6' }],
        /**
         * Teks untuk DIBACA, bukan dipindai: isi bantuan dan penjelasan.
         * Tinggi barisnya lebih longgar justru karena kalimatnya panjang.
         */
        prose: ['0.875rem', { lineHeight: '1.7' }],
        /** Label form, kepala tabel. Sedikit di bawah badan teks, bobot 500. */
        label: ['0.8125rem', { lineHeight: '1.4', fontWeight: '500' }],
        /**
         * HANYA metadata: stempel waktu, keterangan di bawah kotak isian, kode
         * mesin. Bukan tempat kalimat -- 12px sebagai badan teks persis yang
         * membuat keadaan sebelumnya tidak terbaca.
         */
        caption: ['0.75rem', { lineHeight: '1.5' }],
      },
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          // Untuk bidang TERISI berteks putih. Lihat catatan di globals.css --
          // satu merah tidak bisa melayani peran teks dan peran latar sekaligus.
          solid: 'hsl(var(--destructive-solid))',
        },
        card: 'hsl(var(--card))',
        ring: 'hsl(var(--ring))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        surface: {
          raised: 'hsl(var(--surface-raised))',
          sunken: 'hsl(var(--surface-sunken))',
        },
        chart: {
          sent: 'hsl(var(--chart-sent))',
          failed: 'hsl(var(--chart-failed))',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      boxShadow: {
        // Warna DAN kekuatannya token per tema -- lihat catatan di globals.css.
        // Bayangan hitam beropasitas rendah bawaan Tailwind tidak terbaca sama
        // sekali di atas bidang gelap.
        xs: '0 1px 2px 0 hsl(var(--shadow-color) / var(--shadow-strength))',
        sm: '0 1px 3px 0 hsl(var(--shadow-color) / var(--shadow-strength)), 0 1px 2px -1px hsl(var(--shadow-color) / var(--shadow-strength))',
        md: '0 4px 12px -2px hsl(var(--shadow-color) / calc(var(--shadow-strength) * 1.4))',
        lg: '0 12px 32px -8px hsl(var(--shadow-color) / calc(var(--shadow-strength) * 1.8))',
      },
    },
  },
  plugins: [],
};

export default config;
