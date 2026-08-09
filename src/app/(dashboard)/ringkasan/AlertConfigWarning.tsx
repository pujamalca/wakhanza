import { LinkButton, IconAlertTriangle } from '@/components/ui';

/**
 * Rekomendasi teknis 9 Agustus 2026 (R1): seluruh infrastruktur peringatan
 * (`worker/alert.ts`) sudah terpasang -- jeda per jenis, batas waktu keras,
 * tombol uji -- dan tidak satu pun berfungsi bila `alert.webhook_url` kosong.
 * `alert.webhook_url` KOSONG = tidak ada peringatan yang dikirim (disengaja,
 * lihat CLAUDE.md "Peringatan gangguan"), dan pengaman satu-satunya yang
 * tersisa mengandalkan seseorang membuka halaman ini. Panel `SystemStatus` di
 * atas tidak menjawab pertanyaan ini -- ia bisa hijau selama sesi masih hidup,
 * padahal justru saat sesi itu MATI-lah peringatan ini dibutuhkan.
 *
 * Sengaja BUKAN kode yang mengisi URL-nya sendiri: itu kredensial pihak
 * ketiga (bot Telegram / webhook Slack) yang cuma bisa didapat rumah sakit.
 * Yang bisa dikerjakan kode cuma membuat kekosongannya TERLIHAT tanpa harus
 * membuka /pengaturan dan menyisir daftar kunci satu per satu.
 *
 * Menghilang sendiri begitu URL-nya terisi -- tidak ada state "sudah
 * ditutup" yang perlu disimpan, karena begitu diisi pertanyaannya memang
 * sudah terjawab (pola yang sama dengan peringatan `KONTROL_ULANG`/
 * `BOOK_REMIND` di halaman /template: kondisinya sendiri yang menyala/mati,
 * bukan sebuah tombol tutup).
 */
export function AlertConfigWarning({ webhookConfigured }: { webhookConfigured: boolean }) {
  if (webhookConfigured) return null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-warning/40 bg-warning/5 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
          <IconAlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">Tidak ada yang diberi tahu bila gateway berhenti bekerja</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Tujuan peringatan (<code>alert.webhook_url</code>) belum diisi, jadi watchdog sesi tersangkut, kegagalan
            pemeriksaan kesehatan, dan gagal mulai worker tidak mengirim apa pun ke siapa pun. Satu-satunya cara
            mengetahui gangguan sekarang adalah membuka halaman ini secara manual.
          </p>
        </div>
      </div>
      <LinkButton href="/pengaturan" variant="primary" size="md" className="w-full shrink-0 justify-center sm:w-auto">
        Atur sekarang
      </LinkButton>
    </section>
  );
}
