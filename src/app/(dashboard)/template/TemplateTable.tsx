'use client';

import { useActionState, useState, useTransition } from 'react';
import { TRIGGER_TEMPLATE_VARIABLES, BROADCAST_TEMPLATE_VARIABLES } from '@/core/template';
import {
  Input,
  MessageEditor,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  EmptyState,
  IconFileText,
  triggerLabel,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { updateTemplateAction } from './actions';
import { createBroadcastTemplateAction, updateBroadcastTemplateAction, deleteBroadcastTemplateAction } from './broadcastActions';
import { TargetPemicuModal, type TargetPemicuRow, type GrupRow } from './TargetPemicuModal';
import type { TujuanMode } from '@/models';


/** Isi pesan dirapatkan jadi satu baris untuk kolom tabel -- teks utuhnya ada di title dan di modal. */
function ringkas(body: string): string {
  return body.replace(/\s*\n+\s*/g, ' ');
}

export interface TriggerTemplateRow {
  triggerCode: string;
  label: string;
  body: string;
  isActive: boolean;
  tujuanMode: TujuanMode;
  targets: TargetPemicuRow[];
}

export interface BroadcastTemplateRow {
  id: number;
  name: string;
  body: string;
  isActive: boolean;
}

/**
 * Kedua tabel di berkas ini menggantikan grid kartu yang tiap kartunya berisi
 * form terbuka. Alasan yang sama seperti di /balasan-otomatis: kartu menjawab
 * "seperti apa satu template", tabel menjawab "template apa saja yang ada dan
 * mana yang aktif" -- dan yang kedua itulah yang ditanyakan staf saat membuka
 * halaman ini. Penyuntingan jadi tindakan tersendiri dengan awal dan akhir yang
 * jelas, bukan tujuh form yang semuanya tampak siap disimpan.
 */
/**
 * Ringkasan penerima untuk kolom tabel. Menampilkan MODE dan jumlah tujuan
 * aktif berdampingan, karena keduanya baru berarti bersama-sama: "hanya tujuan"
 * dengan nol tujuan aktif berarti pemicunya tidak mengirim ke mana pun, dan itu
 * harus terbaca dari daftar tanpa perlu membuka satu per satu.
 */
function ringkasTujuan(row: TriggerTemplateRow): { teks: string; peringatan: boolean } {
  const aktif = row.targets.filter((t) => t.isActive).length;
  if (row.tujuanMode === 'pasien') return { teks: 'Pasien', peringatan: false };
  if (row.tujuanMode === 'pasien_dan_tujuan') {
    return { teks: `Pasien + ${aktif} tujuan`, peringatan: aktif === 0 };
  }
  return { teks: aktif === 0 ? 'Tidak ke mana pun' : `${aktif} tujuan (tanpa pasien)`, peringatan: aktif === 0 };
}

export function TriggerTemplateTable({
  rows,
  readOnly,
  grup,
  waSiap,
}: {
  rows: TriggerTemplateRow[];
  readOnly: boolean;
  grup: GrupRow[];
  waSiap: boolean;
}) {
  const [editing, setEditing] = useState<TriggerTemplateRow | null>(null);
  const [mengaturTujuan, setMengaturTujuan] = useState<TriggerTemplateRow | null>(null);

  return (
    <>
      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Jenis pesan</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Judul</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Isi</th>
              <th className={`${cellClass} hidden md:table-cell`}>Penerima</th>
              <th className={cellClass}>Status</th>
              <th className={`${cellClass} w-px`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const tujuan = ringkasTujuan(t);
              return (
                <tr key={t.triggerCode} className={rowClass}>
                  {/* Label manusia di depan, kode pemicu tetap tersedia lewat
                      tooltip -- baris log dan tiket dukungan memakai kodenya. */}
                  <td className={`${cellClass} font-medium`} title={t.triggerCode}>
                    {triggerLabel(t.triggerCode)}
                  </td>
                  <td className={`${cellClass} hidden sm:table-cell`}>{t.label}</td>
                  <td className={`${cellClass} hidden max-w-md truncate text-muted-foreground lg:table-cell`} title={t.body}>
                    {ringkas(t.body)}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap md:table-cell`}>
                    <Badge variant={tujuan.peringatan ? 'warning' : 'neutral'}>{tujuan.teks}</Badge>
                  </td>
                  <td className={cellClass}>
                    <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={cellClass}>
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => setMengaturTujuan(t)}>
                        Tujuan
                      </Button>
                      <Button variant="secondary" size="xs" onClick={() => setEditing(t)}>
                        {readOnly ? 'Lihat' : 'Ubah'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <TriggerTemplateModal key={editing.triggerCode} row={editing} readOnly={readOnly} onClose={() => setEditing(null)} />
      )}

      {mengaturTujuan && (
        <TargetPemicuModal
          key={`tujuan-${mengaturTujuan.triggerCode}`}
          triggerCode={mengaturTujuan.triggerCode}
          modeAwal={mengaturTujuan.tujuanMode}
          targets={mengaturTujuan.targets}
          grup={grup}
          waSiap={waSiap}
          readOnly={readOnly}
          onClose={() => setMengaturTujuan(null)}
        />
      )}
    </>
  );
}

function TriggerTemplateModal({
  row,
  readOnly,
  onClose,
}: {
  row: TriggerTemplateRow;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      const result = await updateTemplateAction(row.triggerCode, formData);
      if (!result.error) onClose();
      return result;
    },
    {},
  );

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={triggerLabel(row.triggerCode)}
      description={`Dipakai otomatis oleh worker saat kejadiannya terdeteksi di Khanza. Kode pemicu: ${row.triggerCode}`}
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Judul</span>
          <Input name="label" defaultValue={row.label} disabled={readOnly} className="w-full" fieldSize="sm" />
        </label>
        <div className="space-y-1">
          <span className="block text-xs font-medium">Isi pesan</span>
          <MessageEditor
            name="body"
            defaultValue={row.body}
            variables={TRIGGER_TEMPLATE_VARIABLES}
            disabled={readOnly}
            rows={7}
          />
        </div>
        {!readOnly && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="isActive" defaultChecked={row.isActive} className="accent-primary" />
            Aktif — kalau dimatikan, jenis pesan ini berhenti dikirim sama sekali
          </label>
        )}
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {readOnly ? 'Tutup' : 'Batal'}
          </Button>
          {!readOnly && (
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>
              {isPending ? 'Menyimpan...' : 'Simpan perubahan'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function BroadcastTemplateTable({ rows, readOnly }: { rows: BroadcastTemplateRow[]; readOnly: boolean }) {
  const [editing, setEditing] = useState<BroadcastTemplateRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BroadcastTemplateRow | null>(null);
  const [pendingDelete, startDelete] = useTransition();

  return (
    <>
      {/* Disembunyikan saat daftar kosong: keadaan kosong sudah punya tombolnya
          sendiri, dan dua tombol "Tambah" identik di satu layar membuat staf
          berhenti sejenak menebak apakah keduanya melakukan hal berbeda. */}
      {!readOnly && rows.length > 0 && (
        <div className="mb-3 flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            Tambah template
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconFileText className="h-6 w-6" />}
          title="Belum ada template broadcast"
          action={
            readOnly ? undefined : (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                Tambah template pertama
              </Button>
            )
          }
        >
          Template di sini hanya alat bantu penyusunan — broadcast tetap bisa dikirim tanpa satu pun template.
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={cellClass}>Nama</th>
                <th className={`${cellClass} hidden md:table-cell`}>Isi</th>
                <th className={cellClass}>Status</th>
                <th className={`${cellClass} w-px`}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={rowClass}>
                  <td className={`${cellClass} font-medium`}>{t.name}</td>
                  <td className={`${cellClass} hidden max-w-md truncate text-muted-foreground md:table-cell`} title={t.body}>
                    {ringkas(t.body)}
                  </td>
                  <td className={cellClass}>
                    <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={cellClass}>
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => setEditing(t)}>
                        {readOnly ? 'Lihat' : 'Ubah'}
                      </Button>
                      {!readOnly && (
                        <Button variant="destructive" size="xs" onClick={() => setDeleting(t)}>
                          Hapus
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <BroadcastTemplateModal key={editing.id} row={editing} readOnly={readOnly} onClose={() => setEditing(null)} />
      )}
      {creating && <BroadcastTemplateModal key="baru" row={null} readOnly={false} onClose={() => setCreating(false)} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        pending={pendingDelete}
        title={`Hapus template "${deleting?.name ?? ''}"?`}
        message={
          <>
            Aman: jadwal broadcast yang sedang berjalan menyimpan{' '}
            <span className="font-medium text-foreground">salinan pesannya sendiri</span>, jadi tidak ikut berubah maupun rusak.
            Template di sini murni alat bantu penyusunan.
          </>
        }
        onConfirm={() => {
          const id = deleting?.id;
          if (id === undefined) return;
          startDelete(async () => {
            await deleteBroadcastTemplateAction(id);
            setDeleting(null);
          });
        }}
      />
    </>
  );
}

function BroadcastTemplateModal({
  row,
  readOnly,
  onClose,
}: {
  row: BroadcastTemplateRow | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    async (prev: { error?: string; ok?: boolean }, formData: FormData) => {
      const result = row ? await updateBroadcastTemplateAction(row.id, formData) : await createBroadcastTemplateAction(prev, formData);
      if (!result.error) onClose();
      return result;
    },
    {},
  );

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={row ? `Ubah template: ${row.name}` : 'Template broadcast baru'}
      description="Dipilih manual saat menyusun Broadcast atau Broadcast terjadwal."
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama</span>
          <Input
            name="name"
            defaultValue={row?.name}
            disabled={readOnly}
            placeholder="mis. Tindak lanjut 3 hari"
            className="w-full"
            fieldSize="sm"
            autoFocus
          />
        </label>
        <div className="space-y-1">
          <span className="block text-xs font-medium">Isi pesan</span>
          <MessageEditor
            name="body"
            defaultValue={row?.body ?? ''}
            variables={BROADCAST_TEMPLATE_VARIABLES}
            disabled={readOnly}
            rows={7}
            placeholder="Bpk/Ibu {nama_pasien}, ..."
            hint={
              <span className="block text-xs text-muted-foreground">
                Variabelnya lebih sedikit dari template pemicu karena satu broadcast bisa merentang banyak kunjungan.
              </span>
            }
          />
        </div>
        {row && !readOnly && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="isActive" defaultChecked={row.isActive} className="accent-primary" />
            Aktif — muncul di pilihan broadcast
          </label>
        )}
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {readOnly ? 'Tutup' : 'Batal'}
          </Button>
          {!readOnly && (
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>
              {isPending ? 'Menyimpan...' : row ? 'Simpan perubahan' : 'Tambah template'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
