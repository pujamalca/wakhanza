'use client';

import { useActionState, useState, useTransition } from 'react';
import { AUTOREPLY_TEMPLATE_VARIABLES } from '@/core/template';
import {
  Input,
  MessageEditor,
  Select,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  EmptyState,
  Petunjuk,
  IconReply,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { createRuleAction, updateRuleAction, deleteRuleAction } from './actions';

export interface RuleRow {
  id: number;
  label: string;
  keywords: string[];
  matchMode: 'contains' | 'exact';
  body: string;
  priority: number;
  isActive: boolean;
  usage: number;
}


/**
 * Daftar aturan sebagai TABEL, bukan grid kartu berisi form yang semuanya
 * terbuka sekaligus.
 *
 * Bentuk kartu sempat dipakai dan salah untuk pekerjaan ini: tiap kartu
 * setinggi ~320px, jadi delapan aturan sudah memaksa staf menggulir jauh hanya
 * untuk menjawab "aturan mana yang menangani kata ini". Yang lebih buruk,
 * semua form terbuka sekaligus membuat tidak jelas mana yang sedang disunting
 * -- tidak ada keadaan "sedang mengubah", jadi tombol Simpan di delapan tempat
 * berbeda semuanya tampak sama-sama aktif. Tabel menjawab pertanyaan
 * "apa saja yang ada dan urutannya bagaimana" dalam satu layar, dan penyuntingan
 * jadi tindakan tersendiri yang jelas awal-akhirnya.
 */
export function RuleTable({ rules, hariRingkasan }: { rules: RuleRow[]; hariRingkasan: number }) {
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [pendingDelete, startDelete] = useTransition();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Diperiksa dari urutan terkecil ke terbesar. Taruh aturan spesifik di atas yang umum — &ldquo;jadwal hari ini&rdquo;
          harus diperiksa sebelum &ldquo;jadwal&rdquo;, kalau tidak yang umum selalu menang lebih dulu.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="shrink-0">
          Tambah aturan
        </Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={<IconReply className="h-6 w-6" />}
          title="Belum ada aturan"
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Tambah aturan pertama
            </Button>
          }
        >
          Tanpa aturan, tidak ada pesan masuk yang dibalas.
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={`${cellClass} w-14`}>
                  <span className="inline-flex items-center gap-1">
                    Urut
                    <Petunjuk untuk="Urutan aturan">
                      Aturan dengan urutan lebih kecil diperiksa lebih dulu, dan{' '}
                      <strong>yang pertama cocok menang</strong> — satu pesan masuk paling banyak menghasilkan satu
                      balasan. Bukan &quot;yang paling mirip&quot;: kenapa sebuah aturan yang menjawab harus terjawab
                      dengan melihat daftar terurut ini.
                    </Petunjuk>
                  </span>
                </th>
                <th className={`${cellClass} whitespace-nowrap`}>Nama</th>
                <th className={`${cellClass} hidden md:table-cell`}>Kata kunci</th>
                <th className={`${cellClass} hidden xl:table-cell`}>Isi balasan</th>
                {/* Header dan sel WAJIB memakai breakpoint yang sama persis --
                    kalau berbeda, ada rentang lebar di mana kolomnya punya
                    judul tanpa isi dan seluruh kolom sesudahnya bergeser satu. */}
                <th className={`${cellClass} hidden 2xl:table-cell`}>Cara cocok</th>
                <th className={cellClass}>Status</th>
                <th className={`${cellClass} hidden lg:table-cell`}>Pemakaian</th>
                <th className={`${cellClass} w-px`}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={rowClass}>
                  <td className={`${cellClass} tabular-nums text-muted-foreground`}>{r.priority}</td>
                  {/* whitespace-nowrap: tanpa itu "Jadwal dokter hari ini"
                      terpecah tiga baris dan barisnya jadi setinggi tiga kali
                      lipat. Pembungkus tabel sudah overflow-x-auto, jadi di
                      layar sempit ia menggeser, bukan merusak tata letak. */}
                  <td className={`${cellClass} whitespace-nowrap font-medium`}>{r.label}</td>
                  <td className={`${cellClass} hidden md:table-cell`}>
                    <div className="flex flex-wrap gap-1">
                      {r.keywords.slice(0, 2).map((k) => (
                        <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {k}
                        </span>
                      ))}
                      {r.keywords.length > 2 && (
                        <span className="px-1 text-xs text-muted-foreground" title={r.keywords.join(', ')}>
                          +{r.keywords.length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${cellClass} hidden max-w-56 truncate text-muted-foreground xl:table-cell`} title={r.body}>
                    {r.body.replace(/\n+/g, ' ')}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap text-xs text-muted-foreground 2xl:table-cell`}>
                    {r.matchMode === 'exact' ? 'Persis' : 'Di dalam pesan'}
                  </td>
                  <td className={cellClass}>
                    <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell`}>
                    {!r.isActive
                      ? 'tidak diperiksa'
                      : r.usage > 0
                        ? `${r.usage}× / ${hariRingkasan} hari`
                        : `belum pernah`}
                  </td>
                  <td className={cellClass}>
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => setEditing(r)}>
                        Ubah
                      </Button>
                      <Button variant="destructive" size="xs" onClick={() => setDeleting(r)}>
                        Hapus
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* key={id} supaya defaultValue tiap field ikut berganti saat baris lain
          dipilih -- tanpa itu React memakai ulang input yang sama dan form
          menampilkan isi aturan sebelumnya. */}
      {editing && (
        <RuleModal key={editing.id} rule={editing} onClose={() => setEditing(null)} />
      )}
      {creating && <RuleModal key="baru" rule={null} onClose={() => setCreating(false)} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        pending={pendingDelete}
        title={`Hapus aturan "${deleting?.label ?? ''}"?`}
        message={
          <>
            Pesan yang sudah terkirim tidak terpengaruh. Sesudah dihapus, pesan pasien yang tadinya cocok dengan aturan ini{' '}
            <span className="font-medium text-foreground">tidak akan dibalas lagi</span>.
          </>
        }
        onConfirm={() => {
          const id = deleting?.id;
          if (id === undefined) return;
          startDelete(async () => {
            await deleteRuleAction(id);
            setDeleting(null);
          });
        }}
      />
    </>
  );
}

function RuleModal({ rule, onClose }: { rule: RuleRow | null; onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(
    async (prev: { error?: string; ok?: boolean }, formData: FormData) => {
      const result = rule ? await updateRuleAction(rule.id, formData) : await createRuleAction(prev, formData);
      // Ditutup hanya bila benar-benar tersimpan. Menutup saat gagal validasi
      // akan membuang teks yang sudah diketik staf tanpa memberi tahu kenapa.
      if (!result.error) onClose();
      return result;
    },
    {},
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={rule ? `Ubah aturan: ${rule.label}` : 'Aturan baru'}
      description="Balasan dikirim saat pesan pasien memuat salah satu kata kunci."
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama aturan</span>
          <Input
            name="label"
            defaultValue={rule?.label}
            placeholder="mis. Jam besuk"
            className="w-full"
            fieldSize="sm"
            autoFocus
          />
          <span className="block text-xs text-muted-foreground">Hanya untuk staf sendiri, tidak dikirim ke pasien.</span>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Kata kunci</span>
          <Input
            name="keywords"
            defaultValue={rule?.keywords.join(', ')}
            placeholder="jam besuk, besuk, waktu besuk"
            className="w-full"
            fieldSize="sm"
          />
          <span className="block text-xs text-muted-foreground">
            Dipisah koma. Cocok sebagai <span className="font-medium">kata utuh</span>{' '}
            di mana pun dalam kalimat pasien — &ldquo;obat&rdquo; tidak ikut cocok pada &ldquo;obatan&rdquo;. Huruf besar-kecil,
            tanda baca, dan emoji diabaikan.
          </span>
        </label>

        <div className="space-y-1">
          <span className="block text-xs font-medium">Isi balasan</span>
          <MessageEditor
            name="body"
            defaultValue={rule?.body ?? ''}
            variables={AUTOREPLY_TEMPLATE_VARIABLES}
            rows={6}
            placeholder="Jam besuk di {nama_rs}: 10.00-12.00 dan 17.00-19.00."
            hint={
              <span className="block text-xs text-muted-foreground">
                <span className="font-mono">{'{jadwal_dokter}'}</span> otomatis dipersempit ke poli yang disebut pasien bila
                jelas.
              </span>
            }
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 space-y-1">
            <span className="block text-xs font-medium">Cara cocok</span>
            <Select name="matchMode" defaultValue={rule?.matchMode ?? 'contains'} fieldSize="sm" className="w-full">
              <option value="contains">Ada di dalam pesan</option>
              <option value="exact">Persis seluruh pesan</option>
            </Select>
          </label>
          <label className="w-24 space-y-1">
            <span className="block text-xs font-medium">Urutan</span>
            <Input
              name="priority"
              type="number"
              min={1}
              max={999}
              defaultValue={rule?.priority ?? 100}
              fieldSize="sm"
              className="w-full"
            />
          </label>
          {rule && (
            <label className="flex items-center gap-1.5 pb-2 text-xs">
              <input type="checkbox" name="isActive" defaultChecked={rule.isActive} className="accent-primary" />
              Aktif
            </label>
          )}
        </div>

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan...' : rule ? 'Simpan perubahan' : 'Tambah aturan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
