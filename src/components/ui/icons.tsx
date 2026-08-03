import type { SVGProps } from 'react';

/**
 * Ikon garis 24-grid, digambar sendiri alih-alih menambah dependensi paket
 * ikon: yang dipakai dashboard ini cuma sekitar dua lusin, sementara paket
 * seperti lucide menarik ribuan modul ke dalam bundel klien.
 *
 * Semuanya memakai `currentColor` dan tidak pernah menetapkan warna sendiri --
 * jadi ikon selalu ikut warna teks di sekitarnya (termasuk saat menu aktif
 * berubah jadi warna primer) tanpa perlu prop warna terpisah. `strokeWidth` 1.75
 * dipilih supaya tetap terbaca pada 16px tanpa terlihat berat berdampingan
 * dengan teks `text-sm`.
 *
 * Semua ikon di sini murni dekoratif -- selalu didampingi label teks, jadi
 * `aria-hidden` permanen dan tidak ada prop untuk mematikannya. Kalau suatu
 * saat butuh ikon yang berdiri sendiri sebagai satu-satunya makna (mis. tombol
 * tanpa teks), berikan `aria-label` pada TOMBOLNYA, bukan pada svg ini.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function Icon({ className = 'h-4 w-4', children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Ikon menu ────────────────────────────────────────────────────────────── */

export const IconGauge = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="m13.4 10.6 3.6-3.6" />
    <path d="M3.6 18a9 9 0 1 1 16.8 0" />
  </Icon>
);

export const IconPlug = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 2v6M15 2v6" />
    <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" />
    <path d="M12 17v5" />
  </Icon>
);

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 13h4l1.5 3h7L17 13h4" />
    <path d="M5.4 5.5a1 1 0 0 1 .9-.5h11.4a1 1 0 0 1 .9.5L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
  </Icon>
);

export const IconFileText = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Icon>
);

export const IconPhoneAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3h3l2 5-2.2 1.3a12 12 0 0 0 5.9 5.9L15 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    <path d="M19 3v5M19 10.5v.5" />
  </Icon>
);

export const IconBan = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </Icon>
);

export const IconMegaphone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9v6a1 1 0 0 0 1 1h3l9 4V4L8 8H5a1 1 0 0 0-1 1Z" />
    <path d="M20 9.5v5" />
    <path d="M8 16v4" />
  </Icon>
);

/** Gelembung percakapan dengan panah balik -- satu-satunya fitur yang membalas, bukan mengirim. */
export const IconReply = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2-2.5A8 8 0 1 1 21 12Z" />
    <path d="M13 9.5 10 12l3 2.5" />
    <path d="M10 12h5" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5 13 5a7.5 7.5 0 0 1 2 .8l2.4-1 1.8 1.8-1 2.4a7.5 7.5 0 0 1 .8 2l2.5 1v2.5l-2.5 1a7.5 7.5 0 0 1-.8 2l1 2.4-1.8 1.8-2.4-1a7.5 7.5 0 0 1-2 .8l-1 2.5H11l-1-2.5a7.5 7.5 0 0 1-2-.8l-2.4 1-1.8-1.8 1-2.4a7.5 7.5 0 0 1-.8-2l-2.5-1V11l2.5-1a7.5 7.5 0 0 1 .8-2l-1-2.4 1.8-1.8 2.4 1a7.5 7.5 0 0 1 2-.8l1-2.5Z" />
  </Icon>
);

export const IconActivity = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </Icon>
);

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v5.5c0 4.4-2.9 8.4-7 9.5-4.1-1.1-7-5.1-7-9.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </Icon>
);

/**
 * Dua sosok, yang belakang terpotong -- bukan tiga sosok sejajar. Pada 16px di
 * sidebar, tiga bentuk dalam 24 grid saling menempel jadi satu gumpalan dan
 * tidak lagi terbaca sebagai orang.
 */
export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
    <path d="M16.5 5.2a3.5 3.5 0 0 1 0 5.6" />
    <path d="M18.5 14.9c1.9.8 3 2.4 3 4.1" />
  </Icon>
);

/* ── Ikon antarmuka ───────────────────────────────────────────────────────── */

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const IconAlertTriangle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 16.5v.5" />
  </Icon>
);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </Icon>
);

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const IconLogout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    <path d="M16 16l4-4-4-4M20 12H10" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
    <path d="M20 20v-4.5h-4.5" />
  </Icon>
);
