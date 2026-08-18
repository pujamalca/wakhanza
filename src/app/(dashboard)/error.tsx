'use client';

import { Button, Callout, LinkButton, PageHeader } from '@/components/ui';

/**
 * Batas galat BERSAMA untuk seluruh rute dashboard.
 *
 * Sampai berkas ini ada, TIDAK ADA satu pun `error.tsx` di `src/app`. Query yang
 * gagal di dalam Server Component -- kolam koneksi habis karena SIMRS sedang
 * ramai, MariaDB sedang dimuat ulang, satu kolom Khanza berubah bentuk -- naik
 * sampai akar dan mendarat sebagai layar bawaan Next.js: satu kalimat Inggris
 * tanpa jalan kembali, tanpa nama halaman, tanpa tombol apa pun. Petugas loket
 * yang melihatnya tidak punya langkah berikutnya selain menelepon.
 *
 * Ditaruh di tingkat GRUP dengan alasan yang sama seperti `loading.tsx`: satu
 * berkas menutup dua puluh rute, dan rute yang perlu penanganan khusus tetap
 * boleh menaruh miliknya sendiri.
 *
 * ## Kalimat yang paling penting di halaman ini bukan galatnya
 *
 * Dashboard dan worker adalah DUA PROSES yang tidak pernah saling memanggil.
 * Dashboard yang rusak karena itu TIDAK menghentikan pengiriman WhatsApp --
 * poller, dispatcher, dan sesi WhatsApp jalan terus di proses sebelah. Tanpa
 * kalimat itu di layar, kesimpulan pertama siapa pun yang melihat halaman galat
 * adalah "sistemnya mati", dan tindakan yang menyusul biasanya menyalakan ulang
 * sesuatu yang sedang bekerja dengan benar.
 *
 * `digest` ditampilkan apa adanya dalam huruf mono kecil. Itu mengikuti aturan
 * yang sama dengan `labels.ts`: istilah mesin tidak pernah jadi SATU-SATUNYA
 * yang terbaca petugas, tapi kodenya tetap tersedia berdampingan supaya baris
 * log di server bisa dicocokkan dengan layar yang dilihat pelapor. Pesan galat
 * aslinya sengaja TIDAK dicetak -- ia bisa memuat potongan query berikut nilai
 * yang sedang dicari, dan nilai itu bisa berupa nomor rekam medis.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Halaman ini gagal dimuat"
        description="Yang gagal adalah pengambilan datanya, bukan pengiriman WhatsApp."
      />

      <Callout variant="warning" title="Pengiriman pesan TIDAK ikut berhenti">
        Dashboard dan proses pengirim berjalan terpisah dan tidak pernah saling memanggil. Antrean,
        pemicu, dan sesi WhatsApp tetap berjalan selama proses pengirim hidup. Jangan menyalakan ulang
        apa pun hanya karena halaman ini gagal.
      </Callout>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={reset}>
          Coba muat ulang
        </Button>
        <LinkButton href="/ringkasan">Ke Ringkasan</LinkButton>
      </div>

      {error.digest ? (
        <p className="text-caption text-muted-foreground">
          Kode kejadian: <span className="font-mono">{error.digest}</span>. Sebutkan kode ini bila
          melapor ke IT; kode yang sama tercatat di log server.
        </p>
      ) : null}
    </div>
  );
}
