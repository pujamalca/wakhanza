'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  Input,
  Textarea,
  Select,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  EmptyState,
  Petunjuk,
  IconX,
  IconFileText,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { MAKS_PERTANYAAN, type TipeField } from '@/core/waFormulir';
import { createFormAction, updateFormAction, deleteFormAction, toggleFormAction } from './actions';

export interface FieldRow {
  label: string;
  tipe: TipeField;
  wajib: boolean;
  pilihan: string[];
  maksPanjang: number;
}

export interface FormRow {
  id: number;
  nama: string;
  kataKunci: string[];
  matchMode: 'contains' | 'exact';
  priority: number;
  pesanPembuka: string;
  pesanPenutup: string;
  isActive: boolean;
  bolehGrup: boolean;
  fields: FieldRow[];
  jumlahMasuk: number;
}

const FIELD_BARU: FieldRow = { label: '', tipe: 'teks', wajib: true, pilihan: [], maksPanjang: 0 };

export function FormTable({ forms }: { forms: FormRow[] }) {
  const [editing, setEditing] = useState<FormRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FormRow | null>(null);
  const [pendingDelete, startDelete] = useTransition();
  const [pendingToggle, startToggle] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          Diperiksa dari urutan terkecil ke terbesar, dan formulir diperiksa <strong>sebelum</strong> balasan otomatis
          maupun pertanyaan stok.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="shrink-0">
          Tambah formulir
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-destructive/10 p-2.5 text-caption text-destructive">{error}</p>
      )}

      {forms.length === 0 ? (
        <EmptyState
          icon={<IconFileText className="h-6 w-6" />}
          title="Belum ada formulir"
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Buat formulir pertama
            </Button>
          }
        >
          Tanpa formulir, tidak ada kata kunci yang menjaring apa pun.
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-body">
            <thead className={theadClass}>
              <tr>
                <th className={`${cellClass} w-14`}>
                  <span className="inline-flex items-center gap-1">
                    Urut
                    <Petunjuk untuk="Urutan formulir">
                      Yang urutannya lebih kecil diperiksa lebih dulu, dan <strong>yang pertama cocok menang</strong> —
                      satu pesan paling banyak memulai satu formulir.
                    </Petunjuk>
                  </span>
                </th>
                <th className={cellClass}>Nama</th>
                <th className={`${cellClass} hidden md:table-cell`}>Kata kunci</th>
                <th className={`${cellClass} hidden lg:table-cell`}>Pertanyaan</th>
                <th className={cellClass}>Status</th>
                <th className={`${cellClass} w-px whitespace-nowrap`}>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id} className={rowClass}>
                  <td className={`${cellClass} tabular-nums text-muted-foreground`}>{f.priority}</td>
                  <td className={cellClass}>
                    <div className="font-medium">{f.nama}</div>
                    {f.bolehGrup && (
                      <span className="text-caption text-muted-foreground">boleh diisi dari grup</span>
                    )}
                  </td>
                  <td className={`${cellClass} hidden md:table-cell`}>
                    <span className="font-mono text-caption">{f.kataKunci.join(', ')}</span>
                    {f.matchMode === 'exact' && (
                      <span className="block text-caption text-muted-foreground">persis seluruh pesan</span>
                    )}
                  </td>
                  <td className={`${cellClass} hidden lg:table-cell tabular-nums`}>
                    {f.fields.length === 0 ? (
                      <Badge variant="warning">belum ada</Badge>
                    ) : (
                      <span className="text-muted-foreground">{f.fields.length}</span>
                    )}
                  </td>
                  <td className={cellClass}>
                    <Badge variant={f.isActive ? 'success' : 'neutral'}>{f.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pendingToggle}
                        onClick={() =>
                          startToggle(async () => {
                            const hasil = await toggleFormAction(f.id, !f.isActive);
                            setError(hasil.error ?? null);
                          })
                        }
                      >
                        {f.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setEditing(f)}>
                        Ubah
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setDeleting(f)}>
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

      {creating && <FormModal form={null} onClose={() => setCreating(false)} />}
      {editing && <FormModal form={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        pending={pendingDelete}
        title={`Hapus formulir "${deleting?.nama ?? ''}"?`}
        message={
          <>
            Kata kuncinya berhenti menjaring apa pun, dan pertanyaannya hilang.{' '}
            {deleting && deleting.jumlahMasuk > 0 ? (
              <>
                <span className="font-medium text-foreground">
                  {deleting.jumlahMasuk} jawaban yang sudah masuk TIDAK ikut terhapus
                </span>{' '}
                — semuanya tetap terbaca utuh di tab Masuk, lengkap dengan pertanyaan yang dulu diajukan.
              </>
            ) : (
              <>Belum ada satu pun jawaban yang masuk lewat formulir ini.</>
            )}
          </>
        }
        onConfirm={() => {
          const id = deleting?.id;
          if (id === undefined) return;
          startDelete(async () => {
            const hasil = await deleteFormAction(id);
            setError(hasil.error ?? null);
            setDeleting(null);
          });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function FormModal({ form, onClose }: { form: FormRow | null; onClose: () => void }) {
  const [fields, setFields] = useState<FieldRow[]>(form?.fields.length ? form.fields : [FIELD_BARU]);
  const [state, formAction, isPending] = useActionState(
    async (prev: { error?: string; ok?: boolean }, formData: FormData) => {
      const hasil = form ? await updateFormAction(prev, formData) : await createFormAction(prev, formData);
      // Ditutup hanya bila benar-benar tersimpan. Menutup saat gagal validasi
      // akan membuang seluruh pertanyaan yang sudah disusun staf.
      if (!hasil.error) onClose();
      return hasil;
    },
    {},
  );

  const ubah = (i: number, patch: Partial<FieldRow>) =>
    setFields((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={form ? `Ubah formulir: ${form.nama}` : 'Formulir baru'}
      description="Pasien yang mengetik salah satu kata kunci akan dituntun menjawab pertanyaan di bawah, satu per satu."
    >
      <form action={formAction} className="space-y-3">
        {form && <input type="hidden" name="id" value={form.id} />}

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Nama formulir</span>
          <Input
            name="nama"
            defaultValue={form?.nama}
            placeholder="mis. Permintaan obat rutin"
            className="w-full"
            fieldSize="sm"
            autoFocus
          />
          <span className="block text-caption text-muted-foreground">
            Dilihat staf di daftar Masuk, dan dibekukan ke setiap jawaban — jadi ia tetap terbaca sesudah formulir ini
            diubah atau dihapus.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Kata kunci pemicu</span>
          <Input
            name="kataKunci"
            defaultValue={form?.kataKunci.join(', ')}
            placeholder="request obat, minta obat"
            className="w-full"
            fieldSize="sm"
          />
          <span className="block text-caption text-muted-foreground">
            Dipisah koma. Cocok sebagai <strong>kata utuh</strong> di mana pun dalam kalimat pasien. Bentuk bergaris
            miring bekerja sendirinya: kata kunci <span className="font-mono">request obat</span> ikut menjaring{' '}
            <span className="font-mono">/request-obat</span>, karena tanda baca diabaikan di kedua sisi.
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 space-y-1">
            <span className="block text-caption font-medium">Cara cocok</span>
            <Select name="matchMode" defaultValue={form?.matchMode ?? 'contains'} fieldSize="sm" className="w-full">
              <option value="contains">Ada di dalam pesan</option>
              <option value="exact">Persis seluruh pesan</option>
            </Select>
          </label>
          <label className="w-24 space-y-1">
            <span className="block text-caption font-medium">Urutan</span>
            <Input
              name="priority"
              type="number"
              min={1}
              max={999}
              defaultValue={form?.priority ?? 100}
              fieldSize="sm"
              className="w-full"
            />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-caption">
            <input type="checkbox" name="bolehGrup" defaultChecked={form?.bolehGrup} className="accent-primary" />
            <span className="inline-flex items-center gap-1">
              Boleh dari grup
              <Petunjuk untuk="Boleh diisi dari dalam grup WhatsApp">
                Bawaannya tidak, dan itu benar untuk formulir PASIEN — jawabannya akan terbaca seluruh anggota grup.
                Nyalakan untuk formulir internal (mis. laporan kerusakan alat) yang memang paling wajar diisi dari grup
                unit.
              </Petunjuk>
            </span>
          </label>
        </div>

        {/* --- pertanyaan --------------------------------------------------- */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption font-medium">
              Pertanyaan ({fields.length}/{MAKS_PERTANYAAN})
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={fields.length >= MAKS_PERTANYAAN}
              onClick={() => setFields((f) => [...f, { ...FIELD_BARU }])}
            >
              + Tambah pertanyaan
            </Button>
          </div>

          {fields.map((f, i) => (
            <div key={i} className="space-y-2 rounded-md bg-muted/40 p-2">
              <div className="flex items-start gap-2">
                <span className="pt-2 text-caption tabular-nums text-muted-foreground">{i + 1}.</span>
                <Input
                  name="f_label"
                  value={f.label}
                  onChange={(e) => ubah(i, { label: e.target.value })}
                  placeholder="mis. Obat apa yang dibutuhkan?"
                  className="w-full"
                  fieldSize="sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Hapus pertanyaan ${i + 1}`}
                  disabled={fields.length <= 1}
                  onClick={() => setFields((x) => x.filter((_, j) => j !== i))}
                >
                  <IconX className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 pl-5">
                <label className="space-y-1">
                  <span className="block text-caption text-muted-foreground">Jenis jawaban</span>
                  <Select
                    name="f_tipe"
                    value={f.tipe}
                    onChange={(e) => ubah(i, { tipe: e.target.value as TipeField })}
                    fieldSize="sm"
                  >
                    <option value="teks">Teks bebas</option>
                    <option value="angka">Angka</option>
                    <option value="pilihan">Pilihan</option>
                  </Select>
                </label>
                {/*
                  `<select>` ya/tidak, SENGAJA bukan checkbox. Checkbox yang tidak
                  dicentang sama sekali tidak ikut terkirim, jadi larik `f_wajib`
                  jadi lebih pendek daripada `f_label` dan seluruh nilai sesudah
                  pertanyaan pertama yang tidak dicentang BERGESER satu -- tanpa
                  satu pun galat. Lihat `bacaFields()` di actions.ts.
                */}
                <label className="space-y-1">
                  <span className="block text-caption text-muted-foreground">Wajib diisi</span>
                  <Select
                    name="f_wajib"
                    value={f.wajib ? 'ya' : 'tidak'}
                    onChange={(e) => ubah(i, { wajib: e.target.value === 'ya' })}
                    fieldSize="sm"
                  >
                    <option value="ya">Wajib</option>
                    <option value="tidak">Boleh dilewati</option>
                  </Select>
                </label>
                <label className="w-28 space-y-1">
                  <span className="block text-caption text-muted-foreground">Batas huruf</span>
                  <Input
                    name="f_maks"
                    type="number"
                    min={0}
                    max={4000}
                    value={f.maksPanjang}
                    onChange={(e) => ubah(i, { maksPanjang: Number(e.target.value) })}
                    fieldSize="sm"
                    className="w-full"
                  />
                </label>
              </div>

              {/*
                SELALU dirender, disembunyikan lewat CSS saat jenisnya bukan
                pilihan -- bukan dilepas dari DOM. Input yang tidak dirender tidak
                ikut terkirim, dan larik `f_pilihan` yang lebih pendek daripada
                `f_label` menggeser seluruh nilai sesudahnya. Kelas kegagalan yang
                sama persis dengan checkbox di atas.
              */}
              <label className={`block space-y-1 pl-5 ${f.tipe === 'pilihan' ? '' : 'hidden'}`}>
                <span className="block text-caption text-muted-foreground">Pilihan, dipisah koma</span>
                <Input
                  name="f_pilihan"
                  value={f.pilihan.join(', ')}
                  onChange={(e) =>
                    ubah(i, { pilihan: e.target.value.split(',').map((p) => p.trim()).filter(Boolean) })
                  }
                  placeholder="Umum, BPJS, Asuransi lain"
                  className="w-full"
                  fieldSize="sm"
                />
                <span className="block text-caption text-muted-foreground">
                  Pasien membalas nomornya atau menulis pilihannya. Yang tersimpan selalu <strong>isi</strong>{' '}
                  pilihannya, bukan nomornya.
                </span>
              </label>
            </div>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Kalimat pembuka (boleh kosong)</span>
          <Textarea
            name="pesanPembuka"
            defaultValue={form?.pesanPembuka}
            rows={2}
            placeholder="Baik, saya bantu catat permintaan obat Anda."
            className="w-full"
            fieldSize="sm"
          />
          <span className="block text-caption text-muted-foreground">
            Dikirim sekali sebelum pertanyaan pertama. Dikosongkan, yang tampil hanya nama formulirnya.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Kalimat penutup</span>
          <Textarea
            name="pesanPenutup"
            defaultValue={form?.pesanPenutup}
            rows={2}
            placeholder="Permintaan Anda sudah kami terima. Petugas akan menghubungi dalam 1x24 jam pada jam kerja."
            className="w-full"
            fieldSize="sm"
          />
          <span className="block text-caption text-muted-foreground">
            Wajib diisi — ini satu-satunya tempat pasien diberi tahu <strong>apa yang terjadi berikutnya</strong>. Sistem
            sudah mengulang isian yang tercatat di atasnya, jadi tidak perlu diulang di sini.
          </span>
        </label>

        {state.error && <p className="text-caption text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
