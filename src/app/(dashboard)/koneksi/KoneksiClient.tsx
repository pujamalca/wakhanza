'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { heartbeatStale } from '@/lib/health';
import { diagnosaKoneksi, tindakanKoneksi } from '@/core/koneksiDiagnosa';
import {
  Card,
  Badge,
  Button,
  Skeleton,
  waStatusVariant,
  waStatusLabel,
  waStatusHelp,
  IconRefresh,
  IconLogout,
  IconAlertTriangle,
} from '@/components/ui';

interface KoneksiStatus {
  status: string;
  qrData: string | null;
  qrIssuedAt: string | null;
  phoneNumber: string | null;
  heartbeatAt: string | null;
  lastError: string | null;
  statusSejak: string | null;
  percobaanMenautkan: number;
  jendelaPercobaanMenit: number;
}

function formatSelang(detik: number): string {
  if (detik < 60) return `${detik} detik`;
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} menit`;
  return `${Math.floor(menit / 60)} jam ${menit % 60} menit`;
}

async function fetchStatus(): Promise<KoneksiStatus> {
  const res = await fetch('/api/koneksi/status', { cache: 'no-store' });
  if (!res.ok) throw new Error('gagal mengambil status');
  return res.json();
}

export function KoneksiClient({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['koneksi-status'],
    queryFn: fetchStatus,
    refetchInterval: 3000,
  });

  const commandMutation = useMutation({
    mutationFn: async (command: 'reconnect' | 'logout') => {
      const res = await fetch('/api/koneksi/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) throw new Error('gagal mengirim perintah');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['koneksi-status'] }),
  });

  if (isLoading || !data) {
    return (
      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Card>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-6 w-32" />
          <Skeleton className="mt-3 h-3 w-full" />
        </Card>
      </div>
    );
  }

  const stale = heartbeatStale(data.heartbeatAt);
  const showQr = data.status === 'qr_pending' && data.qrData;

  /**
   * Acuan waktunya `dataUpdatedAt` milik query, BUKAN `Date.now()`.
   *
   * `Date.now()` di badan komponen adalah pemanggilan tak murni dan ditolak
   * `react-hooks/purity` -- aturan yang benar: dua render atas data yang sama
   * tidak boleh berbeda hanya karena waktunya berjalan. Membungkusnya di dalam
   * fungsi pembantu memang menyembunyikannya dari linter, tapi itu menyiasati
   * aturannya alih-alih memenuhinya.
   *
   * `dataUpdatedAt` adalah state milik hook, jadi ia masukan render yang sah,
   * dan ia bergerak tiap `refetchInterval` (3 detik) -- angkanya tetap berjalan
   * di layar selama staf menungguinya. Ia juga lebih jujur: yang ditampilkan
   * memang "sejauh pembacaan terakhir", bukan jam browser yang bisa menyimpang
   * dari jam server.
   */
  const detikDiStatus = data.statusSejak
    ? Math.max(0, Math.floor((dataUpdatedAt - new Date(data.statusSejak).getTime()) / 1000))
    : null;
  const diagnosa = diagnosaKoneksi({
    status: data.status,
    detikDiStatus,
    percobaanMenautkan: data.percobaanMenautkan,
  });
  const menautkanBermasalah = diagnosa === 'menautkan-lama' || diagnosa === 'menautkan-berulang';
  const tindakan = tindakanKoneksi(diagnosa);

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Card>
        <p className="text-sm text-muted-foreground">Status sesi</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={waStatusVariant(data.status)}>{waStatusLabel(data.status)}</Badge>
          {/* Kode mentah tetap ditampilkan berdampingan: itu yang muncul di log
              worker dan di kolom wa_session.status saat menelusuri masalah. */}
          <span className="font-mono text-xs text-muted-foreground">{data.status}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{waStatusHelp(data.status)}</p>

        {/* Berhenti cuma berkata "Menghubungkan".
            Sebelum ini, penautan yang sudah gagal empat belas kali tampak persis
            sama dengan yang baru dimulai delapan detik lalu -- dan staf yang
            menunggui halaman ini tidak punya satu pun cara membedakannya. */}
        {menautkanBermasalah && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
            <p className="flex gap-2">
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <span>
                {diagnosa === 'menautkan-berulang' ? (
                  <>
                    Penautan gagal <span className="font-medium">{data.percobaanMenautkan} kali</span> dalam{' '}
                    {data.jendelaPercobaanMenit} menit terakhir. Worker mencoba lagi sendiri tiap ~3 menit; penautan
                    yang berhasil selesai dalam hitungan detik, jadi yang tersangkut biasanya baru berhasil pada
                    percobaan keberapa.
                  </>
                ) : (
                  <>
                    Sudah <span className="font-medium">{formatSelang(detikDiStatus ?? 0)}</span> di tahap ini.
                    Penautan yang sehat selesai di bawah 15 detik, jadi ini kemungkinan tersangkut — worker akan
                    menyerah pada menit ke-3 lalu mencoba lagi sendiri.
                  </>
                )}
              </span>
            </p>
            <p className="mt-2 pl-6 text-muted-foreground">
              Selama ini berlangsung tidak ada pesan yang terkirim, tapi tidak ada yang hilang: semuanya menunggu di
              antrean dan berangkat begitu sesi hidup.
            </p>

            {/* Menyebutkan masalahnya lalu berhenti di situ adalah persis yang
                dikeluhkan 17 Agustus 2026: staf menunggu, menekan Sambung
                ulang, lalu Keluar sesi -- ketiganya diam, dan halaman ini tidak
                mengatakan satu pun alasannya. Langkahnya datang dari
                `tindakanKoneksi()` supaya yang tertulis di layar dan yang
                dipatok uji adalah daftar yang SAMA. */}
            {tindakan.langkah.length > 0 && (
              <div className="mt-2 pl-6">
                <p className="font-medium">Yang harus dikerjakan, berurutan:</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
                  {tindakan.langkah.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
          {detikDiStatus !== null && data.status !== 'ready' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Di tahap ini sejak</dt>
              <dd className={menautkanBermasalah ? 'text-warning' : ''}>{formatSelang(detikDiStatus)} lalu</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Nomor pengirim</dt>
            <dd className="tabular-nums">{data.phoneNumber ?? '-'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Denyut worker</dt>
            <dd className={stale ? 'text-destructive' : ''}>
              {data.heartbeatAt ? new Date(data.heartbeatAt).toLocaleTimeString('id-ID') : 'belum pernah'}
            </dd>
          </div>
        </dl>

        {data.status === 'ready' && stale && (
          <p className="mt-3 flex gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            <IconAlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Status masih tertulis tersambung, tapi worker berhenti melapor lebih dari 2 menit. Prosesnya kemungkinan macet --
              selama ini berlangsung tidak ada pesan yang benar-benar terkirim.
            </span>
          </p>
        )}

        {data.lastError && (
          <p className="mt-3 break-words rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{data.lastError}</p>
        )}

        {isAdmin && (
          <div className="mt-4 border-t pt-3">
            {/* Perintah dititipkan lewat tabel, bukan dikerjakan seketika:
                dashboard dan worker memang tidak pernah bicara lewat HTTP.
                Tanpa kalimat ini, tombol yang "tidak melakukan apa-apa" selama
                beberapa detik terbaca sebagai rusak, dan orang menekannya lagi
                -- yang pada Sambung ulang berarti menyalakan ulang worker dua
                kali. */}
            {commandMutation.isSuccess && !commandMutation.isPending && (
              <p className="mb-2 rounded-md border border-info/25 bg-info/5 p-2 text-xs text-muted-foreground">
                Perintah terkirim. Worker membacanya paling lama beberapa detik lagi — status di atas berubah sendiri
                begitu dikerjakan.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              /**
               * Dimatikan selama QR tampil, dan itu bukan kehalusan: sejak
               * perintah sesi benar-benar dibaca saat menautkan, tiap tekanan
               * menyalakan ulang worker -- yang menerbitkan QR BARU dan
               * membatalkan kode yang sedang ditatap petugas. Terjadi sungguhan
               * pada 15 Agustus 2026, dua kali berturut-turut.
               *
               * Worker juga menolaknya di sisinya sendiri (lihat
               * `processSessionCommand`), jadi ini lapis kedua -- tapi lapis
               * yang menjelaskan, sementara yang di worker cuma mendiamkan.
               */
              disabled={commandMutation.isPending || !tindakan.sambungUlang.bisa}
              onClick={() => commandMutation.mutate('reconnect')}
            >
              <IconRefresh className="h-4 w-4" />
              Sambung ulang
            </Button>
            <Button
              variant="destructive"
              size="md"
              /**
               * Dimatikan saat penautan tersangkut, dan itu bukan kehati-hatian
               * melainkan kejujuran: `logout()` menuntut halaman WhatsApp yang
               * sudah jadi, sementara loop `session-command` sengaja tidak
               * dinaikkan ke atas `initWaClient()`. Perintahnya akan tersimpan
               * lalu menunggu sesi hidup -- yang justru tidak akan pernah
               * terjadi pada keadaan itu. Sebelum ini tombolnya bisa ditekan dan
               * TIDAK melakukan apa pun, tanpa satu pun keterangan.
               */
              disabled={commandMutation.isPending || !tindakan.keluarSesi.bisa}
              onClick={() => {
                if (confirm('Yakin keluar dari sesi WhatsApp? Semua notifikasi berhenti sampai QR dipindai ulang.')) {
                  commandMutation.mutate('logout');
                }
              }}
            >
              <IconLogout className="h-4 w-4" />
              Keluar sesi
            </Button>
            </div>

            {/* Tombol yang mati tanpa keterangan sama membingungkannya dengan
                tombol yang hidup tapi tidak berbuat apa-apa -- keduanya membuat
                orang menekan lagi. Catatannya ikut ditampilkan untuk tombol
                yang MASIH bisa ditekan tapi punya akibat, bukan cuma yang mati. */}
            {tindakan.sambungUlang.catatan && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Sambung ulang:</span>{' '}
                {tindakan.sambungUlang.catatan}
              </p>
            )}
            {tindakan.keluarSesi.catatan && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Keluar sesi:</span> {tindakan.keluarSesi.catatan}
              </p>
            )}
          </div>
        )}
      </Card>

      {showQr && (
        <Card>
          <p className="font-medium">Pindai untuk menyambungkan</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Buka WhatsApp di ponsel bernomor notifikasi rumah sakit.</li>
            <li>Masuk ke Setelan, lalu Perangkat tertaut.</li>
            <li>Ketuk Tautkan perangkat, arahkan kamera ke kode di bawah.</li>
          </ol>
          {/* data URL lokal (bukan gambar jarak jauh); bg-white sengaja tetap putih
              di kedua tema -- QR butuh kontras penuh supaya bisa dipindai. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.qrData!}
            alt="Kode QR untuk menautkan WhatsApp"
            width={260}
            height={260}
            className="mx-auto mt-4 h-auto w-full max-w-[260px] rounded-lg border bg-white p-3"
          />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Kode berganti sendiri secara berkala. Halaman ini menyegarkan otomatis tiap 3 detik.
          </p>
        </Card>
      )}
    </div>
  );
}
