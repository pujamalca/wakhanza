import { Skeleton, SkeletonTable } from '@/components/ui';

/**
 * Rangka muat BERSAMA untuk seluruh rute dashboard.
 *
 * Sembilan belas dari dua puluh `page.tsx` di grup ini adalah Server Component
 * `async` yang menunggu database SEBELUM merender sebaris pun. Tanpa berkas ini
 * Next.js tidak punya batas Suspense untuk digantikan, sehingga menekan menu
 * tidak mengubah APA PUN di layar sampai query-nya pulang. Yang dibaca petugas
 * dari layar yang diam bukan "sedang dimuat" melainkan "klik saya tidak masuk",
 * lalu ia menekannya lagi -- dan di halaman yang menjalankan agregasi berat itu
 * berarti query yang sama berjalan dua kali di atas database produksi.
 *
 * Ditaruh di tingkat GRUP, bukan disalin ke dua puluh rute: satu berkas menutup
 * semuanya, dan rute yang butuh bentuk khusus tetap boleh menaruh `loading.tsx`
 * sendiri -- yang lebih dalam menang. `ringkasan` sudah begitu sejak awal.
 *
 * Bentuknya sengaja UMUM (judul + saringan + tabel) karena itu bentuk mayoritas
 * halaman di sini. Rangka yang terlalu spesifik untuk satu halaman justru
 * membuat isi halaman LAIN melompat saat datanya datang, yaitu persis hal yang
 * rangka ini ada untuk mencegahnya.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="mb-6 border-b pb-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
