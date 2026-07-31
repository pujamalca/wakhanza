'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Badge, Button, type BadgeVariant } from '@/components/ui';

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

function heartbeatStale(heartbeatAt: string | null): boolean {
  if (!heartbeatAt) return true;
  return Date.now() - new Date(heartbeatAt).getTime() > 2 * 60 * 1000; // §7: >2 menit dianggap worker mati
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'ready') return 'success';
  if (status === 'qr_pending') return 'warning';
  if (status === 'disconnected' || status === 'auth_failure') return 'danger';
  return 'neutral';
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

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Memuat status...</p>;

  const stale = heartbeatStale(data.heartbeatAt);

  return (
    <div className="max-w-md space-y-4">
      <Card>
        <p className="text-sm text-muted-foreground">Status sesi</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={statusVariant(data.status)} className="text-sm">
            {data.status}
          </Badge>
        </div>
        {data.phoneNumber && <p className="mt-2 text-sm">Nomor: {data.phoneNumber}</p>}
        {data.status === 'ready' && (
          <p className={`mt-2 text-xs ${stale ? 'text-destructive' : 'text-muted-foreground'}`}>
            {stale
              ? 'Peringatan: denyut jantung worker tidak terbarui >2 menit -- proses mungkin macet meski status "ready".'
              : `Denyut jantung terakhir: ${new Date(data.heartbeatAt!).toLocaleTimeString('id-ID')}`}
          </p>
        )}
        {data.lastError && <p className="mt-2 text-xs text-destructive">Error: {data.lastError}</p>}
      </Card>

      {data.status === 'qr_pending' && data.qrData && (
        <Card className="text-center">
          <p className="mb-2 text-sm text-muted-foreground">Pindai dengan WhatsApp di ponsel nomor notifikasi RS</p>
          {/* data URL lokal (bukan gambar jarak jauh); bg-white sengaja tetap putih di kedua tema -- QR butuh kontras penuh supaya bisa dipindai */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.qrData}
            alt="QR WhatsApp"
            width={260}
            height={260}
            className="mx-auto rounded-md border bg-white p-2"
          />
        </Card>
      )}

      {isAdmin && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            disabled={commandMutation.isPending}
            onClick={() => commandMutation.mutate('reconnect')}
          >
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
            Keluar
          </Button>
        </div>
      )}
    </div>
  );
}
