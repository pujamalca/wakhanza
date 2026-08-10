'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Input, Button, Badge, MessageEditor } from '@/components/ui';
import { TRIGGER_TEMPLATE_VARIABLES, AUTOREPLY_TEMPLATE_VARIABLES } from '@/core/template';
import { msSettingToSeconds, secondsToMsSetting } from '@/core/duration';
import { testAlertWebhookAction } from './actions';

interface SettingField {
  key: string;
  label: string;
  hint?: string;
  /**
   * Nilainya TERSIMPAN dalam milidetik tapi DITAMPILKAN dalam detik.
   *
   * Kunci `app_setting`-nya tetap `*_ms` dan isinya tetap milidetik -- worker
   * membacanya apa adanya lewat `getSettingNumber` dan tidak ikut berubah.
   * Yang dikonversi hanya angka di layar: "300000" tidak memberi tahu siapa
   * pun bahwa itu lima menit, "300" detik memberi tahu.
   */
  storedAsMs?: boolean;
  /**
   * Field yang isinya PESAN untuk pasien, bukan angka atau sakelar.
   *
   * Sebelumnya semua field memakai satu `<Input>` sebaris -- termasuk kedua
   * pesan di bawah, yang panjangnya satu paragraf penuh dan memuat variabel.
   * Menyunting kalimat berbaris banyak lewat kotak sebaris berarti staf tidak
   * pernah bisa melihat pesan yang sedang ia tulis. Ditandai di sini supaya
   * dirender dengan MessageEditor: toolbar format, sisip variabel, pratinjau.
   */
  variables?: readonly string[];
}

const GROUPS: { title: string; fields: SettingField[] }[] = [
  {
    title: 'Polling',
    fields: [
      { key: 'polling.interval_ms', label: 'Interval polling sisip (detik)', hint: 'Default 60 detik.', storedAsMs: true },
      {
        key: 'polling.scan_interval_ms',
        label: 'Interval pindai booking (detik)',
        hint: 'Default 300 detik (5 menit).',
        storedAsMs: true,
      },
      { key: 'polling.lookback_days', label: 'Jendela mundur (hari)' },
      { key: 'polling.query_timeout_sec', label: 'Batas waktu query (detik)' },
    ],
  },
  {
    title: 'Pengiriman',
    fields: [
      { key: 'dispatch.quiet_hours_start', label: 'Jam tenang mulai (0-23)' },
      { key: 'dispatch.quiet_hours_end', label: 'Jam tenang berakhir (0-23)' },
      { key: 'dispatch.send_min_delay_ms', label: 'Jeda kirim minimum (detik)', hint: 'Default 3 detik.', storedAsMs: true },
      {
        key: 'dispatch.send_max_delay_ms',
        label: 'Jeda kirim maksimum (detik)',
        hint: 'Default 8 detik. Jeda tiap pesan diacak antara minimum dan maksimum ini.',
        storedAsMs: true,
      },
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
        hint: 'Ditambahkan sebagai baris terakhir. {waktu} = tanggal & jam kirim, {kode} = 6 karakter pembeda. Bawaan: "Kode Pengiriman : {waktu} {kode}". {kode} tetap ditempelkan walau dihapus dari sini — tanpa itu, satu broadcast menghasilkan ratusan pesan berakhiran teks identik.',
      },
    ],
  },
  {
    title: 'Privasi',
    fields: [
      { key: 'privacy.sensitive_poli_codes', label: 'Kode poli sensitif (JSON array)', hint: '["U0001","U0002"]' },
      { key: 'privacy.sensitive_exam_codes', label: 'Kode pemeriksaan sensitif (JSON array)' },
      {
        key: 'privacy.generic_template',
        label: 'Template pengganti layanan sensitif',
        hint: 'Menggantikan isi pesan pemicu ketika layanan pasien masuk daftar sensitif — jadi ia juga tunduk pada permintaan "Berhenti Kirim Otomatis".',
        variables: TRIGGER_TEMPLATE_VARIABLES,
      },
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
  {
    title: 'Peringatan gangguan',
    fields: [
      {
        key: 'alert.webhook_url',
        label: 'URL webhook peringatan',
        hint:
          'Kosongkan untuk mematikan. SENGAJA bukan WhatsApp, karena yang dilaporkan justru saat WhatsApp tidak jalan. ' +
          'Bot Telegram: https://api.telegram.org/bot<token>/sendMessage?chat_id=<id> -- KEDUA bagian itu wajib; ' +
          'URL bot tanpa /sendMessage atau tanpa chat_id ditolak Telegram (HTTP 400) dan tidak ada peringatan yang pernah sampai. ' +
          'Webhook Slack atau endpoint IT rumah sakit: tempel URL-nya apa adanya. Tekan "Kirim peringatan uji" sesudah Simpan.',
      },
      {
        key: 'alert.min_interval_minutes',
        label: 'Jeda minimum antar peringatan sejenis (menit)',
        hint: 'Gangguan semalaman tidak boleh jadi ratusan pesan -- penerimanya akan berhenti membaca.',
      },
    ],
  },
  {
    // Sakelar utamanya (autoreply.enabled) sengaja TIDAK ada di sini -- ia
    // tinggal di halaman Balasan otomatis, di mana konsekuensinya dijelaskan
    // dan aturannya terlihat. Menyalakan sistem yang menjawab pasien tidak
    // boleh jadi salah satu dari dua puluh kotak isian yang seragam.
    title: 'Balasan otomatis',
    fields: [
      {
        key: 'autoreply.max_per_number_per_hour',
        label: 'Kuota balasan per nomor per jam',
        hint: 'Melindungi nomor RS: satu orang yang mengirim puluhan pesan tidak menghasilkan puluhan balasan beruntun.',
      },
      {
        key: 'autoreply.fallback_body',
        label: 'Pesan saat tak ada yang cocok',
        hint: 'Kosongkan agar DIAM. Pesan yang tidak dikenali sering pertanyaan medis sungguhan yang lebih baik dibaca petugas.',
        variables: AUTOREPLY_TEMPLATE_VARIABLES,
      },
      { key: 'autoreply.fallback_cooldown_minutes', label: 'Jeda pesan cadangan (menit)' },
      {
        key: 'autoreply.schedule_max_rows',
        label: 'Batas baris jadwal per pesan',
        hint: 'Jadwal yang melebihi ini dipotong dengan catatan, bukan dibiarkan terpotong sendiri oleh WhatsApp.',
      },
      {
        key: 'autoreply.log_inbound_text',
        label: 'Simpan teks pesan pasien',
        hint: '1 = simpan (maks 120 karakter) untuk menyetel kata kunci. Default 0 — pesan pasien bisa berisi keluhan medis, dan tabel log ini bukan rekam medis.',
      },
    ],
  },
];

const MS_KEYS = new Set(GROUPS.flatMap((g) => g.fields).filter((f) => f.storedAsMs).map((f) => f.key));

/**
 * Konversi satuan HANYA di dua titik: saat isi form disiapkan, dan saat
 * dikirim balik. Bukan di dalam `onChange` -- di sana staf yang sedang mengetik
 * "1,5" akan kehilangan komanya begitu "1," diubah bolak-balik jadi angka.
 *
 * Keduanya wajib persis kebalikan satu sama lain: form ini mengirim ULANG
 * seluruh kunci saat Simpan ditekan, termasuk yang tidak disentuh, jadi
 * konversi yang meleset sedikit akan menggeser nilai tiap kali disimpan.
 * Dijaga uji `duration.test.ts` ("bolak-balik tanpa berubah").
 */
function petakan(nilai: Record<string, string>, ubah: (v: string) => string): Record<string, string> {
  const hasil = { ...nilai };
  for (const key of MS_KEYS) {
    if (key in hasil) hasil[key] = ubah(hasil[key]!);
  }
  return hasil;
}

/**
 * Tombol uji webhook.
 *
 * Terpisah dari form utama dan TIDAK ikut tombol Simpan: yang diuji adalah
 * nilai yang SUDAH tersimpan, bukan yang sedang diketik. Menguji isi kotak yang
 * belum disimpan akan melaporkan "berhasil" atas URL yang tidak akan dipakai
 * worker saat gangguan sungguhan datang.
 */
function UjiWebhook() {
  const [hasil, setHasil] = useState<{ ok: boolean; message: string } | null>(null);
  const [menguji, setMenguji] = useState(false);

  return (
    <div className="mt-3 border-t border-muted pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={menguji}
          onClick={async () => {
            setMenguji(true);
            setHasil(null);
            try {
              setHasil(await testAlertWebhookAction());
            } catch {
              setHasil({ ok: false, message: 'Gagal memanggil server.' });
            } finally {
              setMenguji(false);
            }
          }}
        >
          {menguji ? 'Mengirim...' : 'Kirim peringatan uji'}
        </Button>
        <p className="text-xs text-muted-foreground">Memakai URL yang sudah tersimpan -- simpan dulu bila baru diubah.</p>
      </div>
      {/*
       * `break-words` wajib sejak alasannya memuat cuplikan jawaban penerima:
       * teks pihak ketiga bisa berupa satu rentetan tanpa spasi (URL, JSON
       * rapat), dan di dalam kolom sempit itu melebarkan seluruh kartu alih-alih
       * membungkus.
       */}
      {hasil && (
        <p className={`mt-2 break-words text-xs ${hasil.ok ? 'text-success' : 'text-destructive'}`}>{hasil.message}</p>
      )}
    </div>
  );
}

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
  const [form, setForm] = useState<Record<string, string>>(() => petakan(initial, msSettingToSeconds));
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
        mutation.mutate(petakan(form, secondsToMsSetting));
      }}
      className="max-w-7xl space-y-4"
    >
      {/*
       * DUA kolom sejak `lg`, lewat multi-kolom CSS dan BUKAN grid.
       *
       * Grid menempatkan kartu baris demi baris, jadi tinggi kelompok di sini yang berbeda jauh
       * (Jadwal 1 baris, Pengiriman 8) meninggalkan lubang sebesar selisihnya di bawah kartu yang
       * lebih pendek. Terukur pada bentuk gridnya: wadah 1.670px dengan ~250px kosong di bawah
       * Polling; multi-kolom memadatkannya jadi 1.062px karena perambannya sendiri yang
       * menyeimbangkan kedua kolom.
       *
       * `break-inside-avoid` yang menjaga satu kartu tidak terbelah di antara dua kolom -- tanpa
       * itu separuh kelompok Pengiriman bisa berpindah kolom di tengah daftar isiannya. Jarak
       * antar kartu WAJIB `mb-4`, bukan `space-y-4`: yang terakhir memberi margin-TOP pada
       * saudara berikutnya, dan margin itu runtuh di puncak kolom kedua.
       *
       * Urutan DOM tetap urutan alirannya (turun kolom kiri, lalu kolom kanan), jadi urutan Tab
       * dan pembaca layar tidak melompat-lompat.
       */}
      <div className="columns-1 gap-4 lg:columns-2">
        {GROUPS.map((group) => (
          <Card key={group.title} className="mb-4 break-inside-avoid">
            <h2 className="mb-3 text-sm font-semibold">{group.title}</h2>
            <div className="space-y-3">
              {group.fields.map((field) =>
                field.variables ? (
                  // Pesan diberi lebar penuh KARTUNYA, label di atas: dua kolom sempit membuat
                  // toolbar dan pratinjau tidak muat. Satu kolom di sini ~632px, dan toolbarnya
                  // `flex flex-wrap` sehingga tetap muat -- kartunya TIDAK perlu melebar melewati
                  // kolomnya. Dicoba begitu lebih dulu, dan akibatnya kotak isian angka di kartu
                  // yang sama ikut melar jadi 610px untuk memuat "60".
                  <div key={field.key} className="space-y-1">
                    <label className="text-sm font-medium">{field.label}</label>
                    {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                    <MessageEditor
                      name={field.key}
                      value={form[field.key] ?? ''}
                      onValueChange={(v) => setForm((f) => ({ ...f, [field.key]: v }))}
                      variables={field.variables}
                      disabled={!isAdmin}
                      rows={4}
                    />
                  </div>
                ) : (
                  // Label dan kotak isian DITUMPUK di layar sempit: dua kolom yang dipaksakan
                  // menyisakan ~120px untuk keterangan yang panjangnya beberapa kalimat.
                  <div key={field.key} className="grid items-start gap-1 sm:grid-cols-2 sm:gap-3">
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
                      // Nilai yang benar-benar masuk database tetap terlihat, jadi
                      // admin yang membandingkan dengan isi `app_setting` atau
                      // baris `audit_log` tidak menyangka angkanya berubah.
                      title={
                        field.storedAsMs
                          ? `Tersimpan sebagai ${secondsToMsSetting(form[field.key] ?? '')} ms`
                          : undefined
                      }
                    />
                  </div>
                ),
              )}
            </div>
            {group.title === 'Peringatan gangguan' && isAdmin && <UjiWebhook />}
          </Card>
        ))}
      </div>

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
