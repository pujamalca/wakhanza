'use client';

import { useActionState, useState } from 'react';
import { renderTemplate, BROADCAST_TEMPLATE_VARIABLES, type TemplateVariable } from '@/core/template';
import { Input, MessageEditor, WaPreview, Select, Button, cardClassName } from '@/components/ui';
import { createScheduleAction } from './actions';
import { HintVariabelBroadcast, type BroadcastTemplateOption } from '../broadcast/ComposeForm';

const DEFAULT_BODY =
  'Bpk/Ibu {nama_pasien}, kami dari {nama_rs} ingin menyampaikan informasi terkait kunjungan Anda sebelumnya. Silakan hubungi {kontak_rs} bila ada pertanyaan.';

const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function ScheduleForm({
  hiddenFilters,
  sampleVars,
  total,
  uniqueCodeFooter,
  isFollowup,
  isPilih,
  templates,
}: {
  hiddenFilters: Record<string, string[]>;
  sampleVars: Partial<Record<TemplateVariable, string>> | null;
  total: number;
  /** Contoh baris kode unik yang ditambahkan otomatis; null bila fitur dimatikan. */
  uniqueCodeFooter: string | null;
  /** Mode jendela terpilih di filter di atas -- menentukan peringatan pengulangan di bawah. */
  isFollowup: boolean;
  /** Penerimanya daftar centang tetap, bukan segmen hasil filter. */
  isPilih: boolean;
  /** Template broadcast tersimpan yang aktif (dikelola di /template). */
  templates: BroadcastTemplateOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    (_prev: { error?: string }, formData: FormData) => createScheduleAction(_prev, formData),
    {},
  );
  const [body, setBody] = useState(DEFAULT_BODY);
  const [repeatKind, setRepeatKind] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('weekly');

  const preview = sampleVars ? renderTemplate(body, sampleVars) : null;

  return (
    <form action={formAction} className={`mt-4 space-y-3 ${cardClassName}`}>
      <h2 className="font-medium">Susun jadwal broadcast</h2>

      {Object.entries(hiddenFilters).map(([name, values]) =>
        values.map((v) => <input key={`${name}-${v}`} type="hidden" name={name} value={v} />),
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium">Nama jadwal (untuk staf sendiri, tidak dikirim ke pasien)</label>
        <Input name="name" placeholder="mis. Pengingat kontrol bulanan BPJS" className="w-full sm:w-1/2" />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Isi pesan</label>
        {templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <span className="text-xs text-muted-foreground">Pakai template:</span>
            <Select
              fieldSize="sm"
              defaultValue=""
              // Teks template DISALIN ke kotak isi, bukan diacu -- jadwal
              // menyimpan salinan pesannya sendiri (message_body), jadi
              // template yang belakangan diubah/dihapus tidak mengubah jadwal
              // yang sudah berjalan.
              onChange={(e) => {
                const picked = templates.find((t) => String(t.id) === e.target.value);
                if (picked) setBody(picked.body);
              }}
            >
              <option value="">-- pilih --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <MessageEditor
          name="messageBody"
          value={body}
          onValueChange={setBody}
          variables={BROADCAST_TEMPLATE_VARIABLES}
          rows={4}
          showPreview={false}
          hint={<HintVariabelBroadcast />}
        />
      </div>

      {preview && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          <p className="mb-1 text-muted-foreground">Pratinjau (contoh pasien pertama dari hasil filter saat ini):</p>
          <p className="whitespace-pre-wrap">
            <WaPreview text={uniqueCodeFooter ? `${preview}\n\n${uniqueCodeFooter}` : preview} />
          </p>
          {uniqueCodeFooter && (
            <p className="mt-2 text-muted-foreground">
              Baris terakhir ditambahkan otomatis dan BERBEDA untuk setiap pasien pada setiap kali jadwal jalan — supaya
              kiriman berulang tidak berisi teks yang identik, yang terbaca sebagai spam oleh WhatsApp. Atur atau matikan di
              Pengaturan.
            </p>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-medium">Pola pengulangan</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ['once', 'Sekali'],
              ['daily', 'Harian'],
              ['weekly', 'Mingguan'],
              ['monthly', 'Bulanan'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="repeatKind"
                value={value}
                checked={repeatKind === value}
                onChange={() => setRepeatKind(value)}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {repeatKind === 'once' ? (
        <div className="space-y-1">
          <label className="text-sm font-medium">Tanggal &amp; jam kirim</label>
          <input
            type="datetime-local"
            name="runOnceAt"
            required
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {repeatKind === 'weekly' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Hari</label>
              <select name="dayOfWeek" defaultValue={1} className="rounded-md border bg-background px-2 py-1 text-sm text-foreground">
                {DAY_LABELS.map((label, value) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {repeatKind === 'monthly' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Tanggal (1-28)</label>
              <input
                type="number"
                name="dayOfMonth"
                min={1}
                max={28}
                defaultValue={1}
                className="w-20 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Jam</label>
            <input
              type="time"
              name="timeOfDay"
              defaultValue="09:00"
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        </div>
      )}

      {/* Kombinasi paling gampang keliru: jendela berjalan + pengulangan.
          Pasien yang sama tetap masuk kriteria selama masih di dalam jendela,
          jadi ia menerima pesan LAGI tiap kali jadwal jalan -- jendela 30 hari
          + harian berarti 30 pesan ke orang yang sama. */}
      {/* Peringatan pengulangan punya DUA bentuk, dan menyamakannya menyesatkan:
          pada jendela berjalan jalan keluarnya adalah mode tindak lanjut,
          sementara pada daftar centang mode itu justru tidak berlaku sama
          sekali -- menyarankannya di sana menyuruh staf menekan pilihan yang
          diabaikan. */}
      {isPilih && repeatKind !== 'once' && (
        <div className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs dark:border-amber-500/40 dark:bg-amber-950">
          Penerimanya <span className="font-medium">daftar centang tetap</span> ({total} pasien), dan jadwal ini berulang. Orang
          yang sama akan menerima pesan <span className="font-medium">setiap kali</span> jadwal jalan &mdash; tidak ada jendela
          tanggal yang bisa mengeluarkan mereka dengan sendirinya. Isi &ldquo;Berhenti otomatis setelah tanggal&rdquo; di bawah.
        </div>
      )}
      {!isPilih && !isFollowup && repeatKind !== 'once' && (
        <div className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs dark:border-amber-500/40 dark:bg-amber-950">
          Filter di atas memakai <span className="font-medium">jendela berjalan</span>, dan jadwal ini berulang. Pasien yang sama
          akan dikirimi <span className="font-medium">setiap kali</span>{' '}
          jadwal jalan selama ia masih di dalam jendela. Untuk &ldquo;kirim sekali, sekian hari setelah kunjungan&rdquo;, pilih{' '}
          <span className="font-medium">Tindak lanjut</span> di filter di atas.
        </div>
      )}

      {repeatKind !== 'once' && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Berhenti otomatis setelah tanggal (opsional)</label>
          <p className="text-xs text-muted-foreground">
            Disarankan diisi -- supaya jadwal tidak berjalan tanpa batas waktu tanpa ada yang meninjau ulang.
          </p>
          <input type="date" name="stopAfterDate" className="rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {/* total === 0 tidak menghalangi mode tindak lanjut: jendelanya satu hari
          kalender, jadi nol hasil HARI INI sering wajar (hari libur) dan bukan
          tanda filternya keliru -- lihat createScheduleAction. */}
      <Button type="submit" variant="primary" size="sm" disabled={isPending || (total === 0 && !isFollowup)}>
        {isPending ? 'Menyimpan...' : 'Simpan jadwal'}
      </Button>
      {total === 0 && isFollowup && (
        <p className="text-xs text-muted-foreground">
          Nol pasien hari ini wajar untuk tindak lanjut — jendelanya satu hari kalender. Jadwal tetap bisa disimpan dan akan
          mengirim pada hari-hari yang ada kunjungannya.
        </p>
      )}
    </form>
  );
}
