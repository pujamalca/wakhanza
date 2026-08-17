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
import type { RincianTujuan } from '@/core/waFormulirTujuan';
import {
  setRincianTujuanAction,
  tambahFormTargetAction,
  ubahFormTargetAction,
  hapusFormTargetAction,
  toggleFormTargetAction,
  kirimUjiFormTargetAction,
  mintaSyncGrupFormulirAction,
  type HasilForm,
} from './tujuanActions';

export interface TujuanFormRow {
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
 * Tiap mode dijelaskan sebagai AKIBAT yang bisa dibayangkan admin, bukan sebagai
 * nama teknis -- "ringkas" tidak memberi tahu siapa pun bahwa artinya isi
 * jawaban pasien tidak ikut beredar.
 */
const RINCIAN: { nilai: RincianTujuan; judul: string; keterangan: string }[] = [
  {
    nilai: 'ringkas',
    judul: 'Ringkas — hanya pemberitahuan',
    keterangan:
      'Grup diberi tahu ada jawaban baru masuk dan berapa pertanyaan terisi. Isi jawaban dan nomor penanya TIDAK ikut — keduanya dibaca di tab Masuk, tempat aksesnya dijaga login.',
  },
  {
    nilai: 'lengkap',
    judul: 'Lengkap — seluruh jawaban ikut',
    keterangan:
      'Seluruh pertanyaan beserta jawabannya, ditambah nomor penanya, dikirim ke grup. Pakai ini bila grupnya memang unit yang menindaklanjuti dan isi itu memang boleh beredar di WhatsApp.',
  },
];

export function TujuanFormulirModal({
  formId,
  formNama,
  rincianAwal,
  targets,
  grup,
  waSiap,
  onClose,
}: {
  formId: number;
  formNama: string;
  rincianAwal: RincianTujuan;
  targets: TujuanFormRow[];
  grup: GrupRow[];
  waSiap: boolean;
  onClose: () => void;
}) {
  const [menambah, setMenambah] = useState(false);
  const [menyunting, setMenyunting] = useState<TujuanFormRow | null>(null);
  const [menghapus, setMenghapus] = useState<TujuanFormRow | null>(null);
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
        title={`Tujuan: ${formNama}`}
        description="Ke mana jawaban yang masuk lewat formulir ini dikabarkan, dan seberapa rinci."
      >
        <div className="space-y-4">
          {pesan.error && <p className="text-sm text-destructive">{pesan.error}</p>}
          {pesan.sukses && <p className="text-sm text-success">{pesan.sukses}</p>}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium">Yang dikirim ke tujuan</legend>
            {RINCIAN.map((m) => (
              <label
                key={m.nilai}
                className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                  rincianAwal === m.nilai ? 'border-primary bg-primary/5' : 'border-transparent'
                }`}
              >
                <input
                  type="radio"
                  name="tujuan_rincian"
                  className="mt-1"
                  checked={rincianAwal === m.nilai}
                  disabled={pending}
                  onChange={() => jalankan(() => setRincianTujuanAction(formId, m.nilai))}
                />
                <span className="block">
                  <span className="block text-sm font-medium">{m.judul}</span>
                  <span className="block text-xs text-muted-foreground">{m.keterangan}</span>
                </span>
              </label>
            ))}
            {rincianAwal === 'lengkap' && (
              <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Yang beredar adalah <span className="font-medium text-foreground">kalimat yang diketik pasien sendiri</span>{' '}
                — bisa memuat keluhan. Pesan yang sudah masuk grup tidak bisa ditarik dari ponsel anggotanya, dan
                keanggotaan grup diatur di luar sistem ini.
              </p>
            )}
          </fieldset>

          <div className="border-t pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Tujuan</span>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={pending || !waSiap}
                  title={waSiap ? undefined : 'WhatsApp belum tersambung'}
                  onClick={() => jalankan(mintaSyncGrupFormulirAction)}
                >
                  Muat daftar grup
                </Button>
                <Button variant="primary" size="xs" onClick={() => setMenambah(true)} disabled={pending}>
                  Tambah tujuan
                </Button>
              </div>
            </div>

            {targets.length === 0 ? (
              <EmptyState icon={<IconUsers className="h-6 w-6" />} title="Belum ada tujuan">
                Jawaban tetap tersimpan dan terlihat di tab Masuk, tapi tidak ada seorang pun yang dikabari saat masuk —
                harus ada yang membuka dashboard untuk mengetahuinya.
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
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="secondary"
                              size="xs"
                              disabled={pending || !waSiap}
                              title={
                                waSiap
                                  ? 'Kirim jawaban sungguhan yang terakhir masuk ke tujuan ini, persis bentuk yang akan dikirim otomatis'
                                  : 'WhatsApp belum tersambung'
                              }
                              onClick={() => jalankan(() => kirimUjiFormTargetAction(t.id))}
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
                              onClick={() => jalankan(() => toggleFormTargetAction(t.id, !t.isActive))}
                            >
                              {t.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </Button>
                            <Button variant="destructive" size="xs" onClick={() => setMenghapus(t)} disabled={pending}>
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

            {targets.length > 0 && !adaAktif && (
              <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                Semua tujuan sedang nonaktif, jadi tidak ada yang dikabari. Jawaban tetap tersimpan di tab Masuk.
              </p>
            )}

            <p className="mt-2 text-xs text-muted-foreground">
              Pengabaran berangkat <span className="font-medium text-foreground">seketika</span>, juga di jam tenang —
              pasien sudah menerima kalimat penutup yang menjanjikan tindak lanjut pada detik yang sama. Nomor rekam
              medis <span className="font-medium text-foreground">tidak pernah</span> ikut, di kedua mode.
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
        <TujuanForm
          key="baru"
          formId={formId}
          formNama={formNama}
          target={null}
          grup={grup}
          onClose={() => setMenambah(false)}
          onSukses={(m) => setPesan({ sukses: m })}
        />
      )}
      {menyunting && (
        <TujuanForm
          key={menyunting.id}
          formId={formId}
          formNama={formNama}
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
            Pesan yang sudah terkirim tidak terpengaruh, dan{' '}
            <span className="font-medium text-foreground">jawaban tetap tersimpan di tab Masuk</span> — yang berhenti
            cuma pemberitahuannya. Kalau hanya ingin menghentikannya sementara, pakai Nonaktifkan.
          </>
        }
        onConfirm={() => {
          const id = menghapus?.id;
          if (id === undefined) return;
          start(async () => {
            setPesan(await hapusFormTargetAction(id));
            setMenghapus(null);
          });
        }}
      />
    </>
  );
}

function TujuanForm({
  formId,
  formNama,
  target,
  grup,
  onClose,
  onSukses,
}: {
  formId: number;
  formNama: string;
  target: TujuanFormRow | null;
  grup: GrupRow[];
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const [jenis, setJenis] = useState<'grup' | 'personal'>(target?.jenis ?? 'grup');
  const [nilai, setNilai] = useState('');

  const [state, formAction, isPending] = useActionState(async (_prev: HasilForm, formData: FormData) => {
    const hasil = target
      ? await ubahFormTargetAction(target.id, formData)
      : await tambahFormTargetAction(formId, formData);
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
          : `Ke mana jawaban formulir "${formNama}" ikut dikabarkan.`
      }
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama tujuan</span>
          <Input
            name="label"
            defaultValue={target?.label}
            placeholder="mis. Grup Apotek"
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
                  Ia akan menerima kalimat yang diketik pasien di WhatsApp pribadinya — pastikan itu memang yang
                  dikehendaki.
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
