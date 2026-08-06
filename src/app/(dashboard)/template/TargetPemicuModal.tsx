'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  Input,
  Select,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  EmptyState,
  IconUsers,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { tampilkanChatId } from '@/core/farmasiTarget';
import { triggerLabel } from '@/components/ui/labels';
import type { TujuanMode } from '@/models';
import {
  setTujuanModeAction,
  tambahTemplateTargetAction,
  ubahTemplateTargetAction,
  hapusTemplateTargetAction,
  toggleTemplateTargetAction,
  kirimUjiTemplateTargetAction,
  mintaSyncGrupTemplateAction,
  type HasilForm,
} from './targetActions';

export interface TargetPemicuRow {
  id: number;
  jenis: 'grup' | 'personal';
  chatId: string;
  label: string;
  isActive: boolean;
}

export interface GrupRow {
  chatId: string;
  nama: string;
  jumlahPeserta: number | null;
}

/**
 * Penjelasan tiap mode ditulis sebagai AKIBAT yang bisa dibayangkan staf, bukan
 * sebagai nama teknis. "pasien_dan_tujuan" tidak memberi tahu siapa pun bahwa
 * artinya satu kejadian menghasilkan beberapa pesan sekaligus.
 */
const MODE: { nilai: TujuanMode; judul: string; keterangan: string }[] = [
  {
    nilai: 'pasien',
    judul: 'Hanya pasien',
    keterangan: 'Seperti biasa — pesan dikirim ke nomor pasien yang bersangkutan saja.',
  },
  {
    nilai: 'pasien_dan_tujuan',
    judul: 'Pasien + tujuan tambahan',
    keterangan: 'Pasien tetap menerima, dan setiap tujuan di bawah menerima salinannya. Dua tujuan berarti dua pesan tambahan per kejadian.',
  },
  {
    nilai: 'tujuan',
    judul: 'Hanya tujuan tambahan',
    keterangan: 'Pasien TIDAK dikirimi sama sekali. Pakai ini bila pemicunya dimaksudkan sebagai koordinasi internal, bukan pemberitahuan pasien.',
  },
];

export function TargetPemicuModal({
  triggerCode,
  modeAwal,
  targets,
  grup,
  waSiap,
  readOnly,
  onClose,
}: {
  triggerCode: string;
  modeAwal: TujuanMode;
  targets: TargetPemicuRow[];
  grup: GrupRow[];
  waSiap: boolean;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [menambah, setMenambah] = useState(false);
  const [menyunting, setMenyunting] = useState<TargetPemicuRow | null>(null);
  const [menghapus, setMenghapus] = useState<TargetPemicuRow | null>(null);
  const [pesan, setPesan] = useState<HasilForm>({});
  const [pending, start] = useTransition();

  function jalankan(fn: () => Promise<HasilForm>) {
    start(async () => setPesan(await fn()));
  }

  const adaAktif = targets.some((t) => t.isActive);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={`Tujuan: ${triggerLabel(triggerCode)}`}
        description={`Ke mana notifikasi pemicu ini dikirim. Kode pemicu: ${triggerCode}`}
      >
        <div className="space-y-4">
          {pesan.error && <p className="text-sm text-destructive">{pesan.error}</p>}
          {pesan.sukses && <p className="text-sm text-success">{pesan.sukses}</p>}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium">Penerima</legend>
            {MODE.map((m) => (
              <label
                key={m.nilai}
                className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                  modeAwal === m.nilai ? 'border-primary bg-primary/5' : 'border-transparent'
                }`}
              >
                <input
                  type="radio"
                  name="tujuan_mode"
                  className="mt-1"
                  checked={modeAwal === m.nilai}
                  disabled={readOnly || pending}
                  onChange={() => jalankan(() => setTujuanModeAction(triggerCode, m.nilai))}
                />
                <span className="block">
                  <span className="block text-sm font-medium">{m.judul}</span>
                  <span className="block text-xs text-muted-foreground">{m.keterangan}</span>
                </span>
              </label>
            ))}
            {modeAwal !== 'pasien' && !adaAktif && (
              <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Tidak ada tujuan yang aktif, jadi salinannya tidak sampai ke mana pun.
              </p>
            )}
            {modeAwal === 'tujuan' && (
              <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Pasien tidak menerima pemberitahuan ini. Pastikan itu memang yang dikehendaki — pasien yang menunggu
                kabar tidak akan mendapat apa pun dari pemicu ini.
              </p>
            )}
          </fieldset>

          <div className="border-t pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Tujuan tambahan</span>
              {!readOnly && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={pending || !waSiap}
                    title={waSiap ? undefined : 'WhatsApp belum tersambung'}
                    onClick={() => jalankan(mintaSyncGrupTemplateAction)}
                  >
                    Muat daftar grup
                  </Button>
                  <Button variant="primary" size="xs" onClick={() => setMenambah(true)} disabled={pending}>
                    Tambah tujuan
                  </Button>
                </div>
              )}
            </div>

            {targets.length === 0 ? (
              <EmptyState icon={<IconUsers className="h-6 w-6" />} title="Belum ada tujuan tambahan">
                Selama belum ada, pemicu ini hanya bisa dikirim ke nomor pasien.
              </EmptyState>
            ) : (
              <div className={tableWrapperClass}>
                <table className="w-full text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={`${cellClass} whitespace-nowrap`}>Nama</th>
                      <th className={`${cellClass} hidden sm:table-cell`}>Jenis</th>
                      <th className={`${cellClass} hidden md:table-cell`}>Alamat</th>
                      <th className={cellClass}>Status</th>
                      <th className={`${cellClass} w-px`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr key={t.id} className={rowClass}>
                        <td className={`${cellClass} whitespace-nowrap font-medium`}>{t.label}</td>
                        <td className={`${cellClass} hidden whitespace-nowrap sm:table-cell`}>
                          <Badge variant="neutral">{t.jenis === 'grup' ? 'Grup' : 'Personal'}</Badge>
                        </td>
                        <td
                          className={`${cellClass} hidden max-w-64 truncate font-mono text-xs text-muted-foreground md:table-cell`}
                          title={t.chatId}
                        >
                          {tampilkanChatId(t.chatId)}
                        </td>
                        <td className={cellClass}>
                          <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                        </td>
                        <td className={cellClass}>
                          {!readOnly && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="secondary"
                                size="xs"
                                disabled={pending || !waSiap}
                                title={waSiap ? 'Kirim satu pesan uji ke tujuan ini' : 'WhatsApp belum tersambung'}
                                onClick={() => jalankan(() => kirimUjiTemplateTargetAction(t.id))}
                              >
                                Kirim uji
                              </Button>
                              <Button variant="secondary" size="xs" onClick={() => setMenyunting(t)} disabled={pending}>
                                Ubah
                              </Button>
                              <Button
                                variant="secondary"
                                size="xs"
                                disabled={pending}
                                onClick={() => jalankan(() => toggleTemplateTargetAction(t.id, !t.isActive))}
                              >
                                {t.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                              </Button>
                              <Button variant="destructive" size="xs" onClick={() => setMenghapus(t)} disabled={pending}>
                                Hapus
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-2 text-xs text-muted-foreground">
              Yang diterima grup adalah <span className="font-medium text-foreground">pesan yang sama</span> dengan yang
              diterima pasien, termasuk namanya. Untuk poli yang ditandai sensitif di Pengaturan, isinya otomatis diganti
              pesan tanpa keterangan layanan. Permintaan berhenti dari pasien{' '}
              <span className="font-medium text-foreground">tidak</span> menghentikan salinan ke grup — yang ia hentikan
              adalah pesan kepadanya sendiri.
            </p>
          </div>

          <div className="flex justify-end border-t pt-3">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
      </Modal>

      {menambah && (
        <TargetForm
          key="baru"
          triggerCode={triggerCode}
          target={null}
          grup={grup}
          onClose={() => setMenambah(false)}
          onSukses={(m) => setPesan({ sukses: m })}
        />
      )}
      {menyunting && (
        <TargetForm
          key={menyunting.id}
          triggerCode={triggerCode}
          target={menyunting}
          grup={grup}
          onClose={() => setMenyunting(null)}
          onSukses={(m) => setPesan({ sukses: m })}
        />
      )}

      <ConfirmDialog
        open={menghapus !== null}
        onClose={() => setMenghapus(null)}
        pending={pending}
        title={`Hapus tujuan "${menghapus?.label ?? ''}"?`}
        confirmLabel="Hapus"
        pendingLabel="Menghapus..."
        message={
          <>
            Pesan yang sudah terkirim tidak terpengaruh. Sesudah dihapus, tujuan ini{' '}
            <span className="font-medium text-foreground">tidak menerima notifikasi pemicu ini lagi</span>. Kalau cuma
            ingin menghentikannya sementara, pakai Nonaktifkan.
          </>
        }
        onConfirm={() => {
          const id = menghapus?.id;
          if (id === undefined) return;
          start(async () => {
            setPesan(await hapusTemplateTargetAction(id));
            setMenghapus(null);
          });
        }}
      />
    </>
  );
}

function TargetForm({
  triggerCode,
  target,
  grup,
  onClose,
  onSukses,
}: {
  triggerCode: string;
  target: TargetPemicuRow | null;
  grup: GrupRow[];
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const [jenis, setJenis] = useState<'grup' | 'personal'>(target?.jenis ?? 'grup');
  const [nilai, setNilai] = useState('');

  const [state, formAction, isPending] = useActionState(async (_prev: HasilForm, formData: FormData) => {
    const hasil = target
      ? await ubahTemplateTargetAction(target.id, formData)
      : await tambahTemplateTargetAction(triggerCode, formData);
    if (!hasil.error) {
      if (hasil.sukses) onSukses(hasil.sukses);
      onClose();
    }
    return hasil;
  }, {});

  return (
    <Modal
      open
      onClose={onClose}
      title={target ? `Ubah tujuan: ${target.label}` : 'Tujuan baru'}
      description={
        target
          ? 'Alamat tujuan tidak bisa diubah — hapus lalu tambah baru bila salah, supaya riwayat pengirimannya tetap jujur.'
          : `Ke mana notifikasi ${triggerLabel(triggerCode)} ikut dikirim.`
      }
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama tujuan</span>
          <Input
            name="label"
            defaultValue={target?.label}
            placeholder="mis. Grup Loket"
            className="w-full"
            fieldSize="sm"
            autoFocus
          />
          <span className="block text-xs text-muted-foreground">
            Hanya untuk staf sendiri. Ditulis sendiri, bukan diambil dari WhatsApp — nama grup bisa diubah anggotanya
            kapan saja.
          </span>
        </label>

        {!target && (
          <>
            <label className="block space-y-1">
              <span className="block text-xs font-medium">Jenis</span>
              <Select
                name="jenis"
                value={jenis}
                onChange={(e) => {
                  setJenis(e.target.value as 'grup' | 'personal');
                  setNilai('');
                }}
                fieldSize="sm"
                className="w-full"
              >
                <option value="grup">Grup WhatsApp</option>
                <option value="personal">Nomor petugas</option>
              </Select>
            </label>

            {jenis === 'grup' ? (
              <div className="space-y-1">
                <span className="block text-xs font-medium">Grup</span>
                {grup.length > 0 ? (
                  <Select
                    value={nilai}
                    onChange={(e) => setNilai(e.target.value)}
                    fieldSize="sm"
                    className="w-full"
                    aria-label="Pilih grup"
                  >
                    <option value="">— pilih grup —</option>
                    {grup.map((g) => (
                      <option key={g.chatId} value={g.chatId}>
                        {g.nama}
                        {g.jumlahPeserta !== null ? ` (${g.jumlahPeserta} anggota)` : ''}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                    Daftar grup belum pernah dimuat. Tekan <span className="font-medium">&ldquo;Muat daftar grup&rdquo;</span>{' '}
                    di jendela sebelumnya, tunggu beberapa detik, lalu muat ulang halaman ini. Nomor WhatsApp rumah sakit
                    harus sudah menjadi anggota grupnya.
                  </p>
                )}
                <Input
                  name="nilai"
                  value={nilai}
                  onChange={(e) => setNilai(e.target.value)}
                  placeholder="120363402118136446@g.us"
                  className="w-full font-mono"
                  fieldSize="sm"
                />
                <span className="block text-xs text-muted-foreground">
                  Terisi sendiri saat grup dipilih di atas. <span className="font-medium">Tautan undangan</span>{' '}
                  (chat.whatsapp.com/…) bukan kode grup dan tidak bisa dipakai.
                </span>
              </div>
            ) : (
              <label className="block space-y-1">
                <span className="block text-xs font-medium">Nomor WhatsApp petugas</span>
                <Input
                  name="nilai"
                  value={nilai}
                  onChange={(e) => setNilai(e.target.value)}
                  placeholder="081234567890"
                  className="w-full"
                  fieldSize="sm"
                />
                <span className="block text-xs text-muted-foreground">
                  Ia akan menerima data pasien di WhatsApp pribadinya — pastikan itu memang yang dikehendaki.
                </span>
              </label>
            )}
          </>
        )}

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan...' : target ? 'Simpan perubahan' : 'Tambah tujuan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
