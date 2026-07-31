'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Input, Button, Badge } from '@/components/ui';

interface SettingField {
  key: string;
  label: string;
  hint?: string;
}

const GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: 'Polling',
    fields: [
      { key: 'polling.interval_ms', label: 'Interval polling sisip (ms)', hint: 'Default 60000' },
      { key: 'polling.scan_interval_ms', label: 'Interval pindai booking (ms)', hint: 'Default 300000' },
      { key: 'polling.lookback_days', label: 'Jendela mundur (hari)' },
      { key: 'polling.query_timeout_sec', label: 'Batas waktu query (detik)' },
    ],
  },
  {
    title: 'Pengiriman',
    fields: [
      { key: 'dispatch.quiet_hours_start', label: 'Jam tenang mulai (0-23)' },
      { key: 'dispatch.quiet_hours_end', label: 'Jam tenang berakhir (0-23)' },
      { key: 'dispatch.send_min_delay_ms', label: 'Jeda kirim minimum (ms)' },
      { key: 'dispatch.send_max_delay_ms', label: 'Jeda kirim maksimum (ms)' },
      { key: 'dispatch.max_per_hour', label: 'Kuota kirim per jam' },
      { key: 'dispatch.stale_threshold_hours_default', label: 'Ambang basi default (jam)' },
      {
        key: 'dispatch.unique_code_enabled',
        label: 'Kode unik tiap pesan',
        hint: '1 = aktif. Membuat setiap pesan berbeda supaya kiriman massal tidak terbaca sebagai spam oleh WhatsApp.',
      },
      {
        key: 'dispatch.unique_code_template',
        label: 'Format kode unik',
        hint: 'Wajib memuat {kode}. Ditambahkan sebagai baris terakhir, mis. "Ref: {kode}".',
      },
    ],
  },
  {
    title: 'Privasi',
    fields: [
      { key: 'privacy.sensitive_poli_codes', label: 'Kode poli sensitif (JSON array)', hint: '["U0001","U0002"]' },
      { key: 'privacy.sensitive_exam_codes', label: 'Kode pemeriksaan sensitif (JSON array)' },
      { key: 'privacy.generic_template', label: 'Template pengganti layanan sensitif' },
    ],
  },
  {
    title: 'Autentikasi',
    fields: [
      { key: 'auth.login_max_attempts', label: 'Batas percobaan login' },
      { key: 'auth.login_lockout_minutes', label: 'Lama kunci akun (menit)' },
    ],
  },
  {
    title: 'Jadwal',
    fields: [{ key: 'schedule.book_remind_hour', label: 'Jam kirim pengingat H-1 (0-23)' }],
  },
];

async function fetchSettings(): Promise<Record<string, string>> {
  const res = await fetch('/api/settings', { cache: 'no-store' });
  if (!res.ok) throw new Error('gagal mengambil pengaturan');
  const data = await res.json();
  return data.settings;
}

function SettingsForm({ initial, isAdmin }: { initial: Record<string, string>; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  // State lokal diinisialisasi dari prop saat komponen pertama kali dipasang
  // (kunci berbeda di pemanggil memaksa remount saat data query berubah) --
  // bukan lewat useEffect+setState yang memicu render berantai.
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Tidak diizinkan (perlu admin).' : 'Gagal menyimpan.');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSavedAt(Date.now());
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(form);
      }}
      className="max-w-2xl space-y-4"
    >
      {GROUPS.map((group) => (
        <Card key={group.title}>
          <h2 className="mb-3 text-sm font-semibold">{group.title}</h2>
          <div className="space-y-3">
            {group.fields.map((field) => (
              <div key={field.key} className="grid grid-cols-2 items-start gap-3">
                <div>
                  <label className="text-sm font-medium">{field.label}</label>
                  {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                </div>
                <Input
                  value={form[field.key] ?? ''}
                  disabled={!isAdmin}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  className="w-full"
                  fieldSize="sm"
                />
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex items-center gap-3">
        {isAdmin && (
          <Button type="submit" variant="primary" size="md" disabled={mutation.isPending}>
            {mutation.isPending ? 'Menyimpan...' : 'Simpan pengaturan'}
          </Button>
        )}
        {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
        {savedAt && !mutation.isPending && <Badge variant="success">Tersimpan</Badge>}
      </div>
    </form>
  );
}

export function PengaturanClient({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, dataUpdatedAt } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Memuat...</p>;

  // key=dataUpdatedAt: form remount dengan initial baru hanya saat query
  // benar-benar refetch (mis. setelah simpan), bukan tiap render.
  return <SettingsForm key={dataUpdatedAt} initial={data} isAdmin={isAdmin} />;
}
