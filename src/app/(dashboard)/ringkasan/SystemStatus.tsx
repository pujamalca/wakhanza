import type { WaSessionStatus } from '@/models';
import { heartbeatStale } from '@/lib/health';
import { LinkButton, IconCheck, IconAlertTriangle, WA_STATUS_LABEL, WA_STATUS_HELP } from '@/components/ui';

/**
 * Baris kesehatan sistem. Sengaja BUKAN sekadar badge kecil di pojok: kalau
 * sesi WhatsApp mati atau worker berhenti melapor, tidak satu pun notifikasi
 * terkirim -- dan angka-angka di bawahnya akan tetap terlihat wajar karena
 * memang menunjukkan masa lalu. Karena itu keadaan bermasalah mengubah seluruh
 * panel, lengkap dengan ikon dan jalan keluarnya, bukan cuma warnanya.
 *
 * Ikon + kalimat mendampingi warnanya di semua keadaan: status tidak boleh
 * bersandar pada warna saja.
 */
export function SystemStatus({
  status,
  phoneNumber,
  heartbeatAt,
  lastError,
}: {
  status: WaSessionStatus;
  phoneNumber: string | null;
  heartbeatAt: Date | null;
  lastError: string | null;
}) {
  const stale = heartbeatStale(heartbeatAt);
  const healthy = status === 'ready' && !stale;

  /**
   * TIGA keadaan, bukan dua, dan denyut basi MENANG atas status apa pun.
   *
   * Sejak denyutnya ditulis tanpa syarat (worker/index.ts), umur denyut menjawab
   * "apakah ada proses worker yang hidup" sementara `status` menjawab "bagaimana
   * keadaan sesi saat baris ini terakhir ditulis". Begitu denyutnya basi, status
   * di baris itu adalah PENINGGALAN proses yang sudah mati -- membacanya sebagai
   * keadaan sekarang menghasilkan diagnosis yang salah, dan salahnya mengarahkan
   * orang ke tindakan yang keliru: `disconnected` + denyut basi akan menyuruh
   * petugas menautkan ulang sesi lewat /koneksi, padahal tidak ada proses yang
   * bisa menerima perintah itu sama sekali.
   *
   * Pembedaannya menentukan siapa yang harus bertindak:
   *   denyut basi              -> prosesnya tidak jalan; PM2/layanan yang diperiksa
   *   denyut hidup, sesi bermasalah -> watchdog memulihkan sendiri <=15 menit
   */
  const workerMati = stale;

  const message = healthy
    ? WA_STATUS_HELP.ready
    : workerMati
      ? 'Worker tidak melapor lebih dari 2 menit, jadi prosesnya kemungkinan besar tidak berjalan. Status sesi di bawah adalah catatan TERAKHIR sebelum ia berhenti, bukan keadaan sekarang. Selama ini berlangsung tidak ada pesan yang terkirim maupun diterima, dan menautkan ulang sesi tidak akan menolong -- yang perlu diperiksa adalah prosesnya sendiri.'
      : WA_STATUS_HELP[status];

  const tone = healthy
    ? 'border-success/30 bg-success/5'
    : workerMati
      ? 'border-destructive/40 bg-destructive/5'
      : status === 'qr_pending' || status === 'authenticating'
        ? 'border-warning/40 bg-warning/5'
        : 'border-destructive/40 bg-destructive/5';

  const iconTone = healthy
    ? 'bg-success/15 text-success'
    : !workerMati && (status === 'qr_pending' || status === 'authenticating')
      ? 'bg-warning/15 text-warning'
      : 'bg-destructive/15 text-destructive';

  return (
    // Di bawah sm tombolnya turun ke baris sendiri selebar panel. Dengan
    // flex-wrap biasa ia tetap bertahan di samping teks (karena kolom teks
    // `flex-1` memilih menyusut alih-alih memaksa baris baru), dan kalimat
    // penjelasnya berakhir sepatah kata per baris di layar ponsel.
    <section className={`flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start ${tone}`}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
          {healthy ? <IconCheck className="h-5 w-5" /> : <IconAlertTriangle className="h-5 w-5" />}
        </span>

        <div className="min-w-0">
          <p className="font-medium">
            {healthy
              ? 'Sistem berjalan normal'
              : workerMati
                ? 'Worker tidak berjalan'
                : `Sesi WhatsApp: ${WA_STATUS_LABEL[status]}`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>
              Nomor pengirim: <span className="text-foreground">{phoneNumber ?? 'belum ada'}</span>
            </span>
            <span>
              Denyut worker:{' '}
              <span className={stale ? 'text-destructive' : 'text-foreground'}>
                {heartbeatAt ? heartbeatAt.toLocaleTimeString('id-ID') : 'belum pernah'}
              </span>
            </span>
          </div>

          {lastError && !healthy && (
            <p className="mt-2 break-words rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {lastError}
            </p>
          )}
        </div>
      </div>

      <LinkButton
        href="/koneksi"
        variant={healthy ? 'secondary' : 'primary'}
        size="md"
        className="w-full shrink-0 justify-center sm:w-auto"
      >
        {/* "Perbaiki sekarang" menjanjikan halaman itu bisa menyelesaikannya, dan
            untuk worker yang mati janji itu keliru -- tidak ada proses yang bisa
            menerima perintah apa pun dari sana. */}
        {healthy ? 'Lihat koneksi' : workerMati ? 'Lihat detail' : 'Perbaiki sekarang'}
      </LinkButton>
    </section>
  );
}
