'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { heartbeatStale } from '@/lib/health';
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
}

async function fetchStatus(): Promise<KoneksiStatus> {
  const res = await fetch('/api/koneksi/status', { cache: 'no-store' });
  if (!res.ok) throw new Error('gagal mengambil status');
  return res.json();
}

export function KoneksiClient({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
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

        <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
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
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
            <Button
              variant="secondary"
              size="md"
              disabled={commandMutation.isPending}
              onClick={() => commandMutation.mutate('reconnect')}
            >
              <IconRefresh className="h-4 w-4" />
              Sambung ulang
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={commandMutation.isPending}
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
