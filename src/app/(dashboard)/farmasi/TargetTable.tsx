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
  Petunjuk,
  IconPill,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { tampilkanChatId } from '@/core/farmasiTarget';
import {
  tambahTargetAction,
  ubahTargetAction,
  hapusTargetAction,
  toggleTargetAction,
  toggleBolehTanyaAction,
  kirimUjiAction,
  mintaSyncGrupAction,
  type HasilForm,
} from './actions';
import { toggleTerimaDaruratAction } from './daruratActions';
import { toggleTerimaPengadaanAction } from './pengadaanActions';
import { toggleTerimaHibahAction } from './hibahActions';
import { toggleTerimaPemesananAction } from './pemesananActions';
import { toggleTerimaPenjualanAction } from './penjualanActions';

export interface TargetRow {
  id: number;
  jenis: 'grup' | 'personal';
  chatId: string;
  label: string;
  isActive: boolean;
  /** Boleh MENGAJUKAN pertanyaan stok/harga dari alamat ini (migrations/020). */
  bolehTanya: boolean;
  terimaDaruratStok: boolean;
  /** Menerima nota PENGADAAN, termasuk harga beli pemasok (migrations/028). */
  terimaPengadaan: boolean;
  /** Menerima nota HIBAH -- barang pemberian, bukan pembelian (migrations/031). */
  terimaHibah: boolean;
  /** Menerima nota SURAT PEMESANAN -- barang yang DIPESAN, belum datang (migrations/030). */
  terimaPemesanan: boolean;
  terimaPenjualan: boolean;
}

export interface GrupRow {
  chatId: string;
  nama: string;
  jumlahPeserta: number | null;
  syncedAt: string;
}

/**
 * Satu centang berikut keterangannya.
 *
 * Keenam centang di kolom ini menjawab pertanyaan yang berbeda-beda, dan
 * jawabannya dulu dititipkan pada atribut `title=` -- yang **tidak pernah
 * muncul di layar sentuh sama sekali**, sehingga di tablet loket keenamnya
 * hanya berupa kata "Hibah", "Pemesanan", "Penjualan" tanpa satu pun cara
 * mengetahui bedanya.
 *
 * **Tombol `Petunjuk` BERSAUDARA dengan `<label>`, bukan di dalamnya**, dan itu
 * bukan kerapian: apa pun yang diklik di dalam sebuah label ikut menyalakan
 * kontrolnya, jadi menekan ikon keterangan akan MENGUBAH setelan yang artinya
 * baru saja hendak ditanyakan. Tidak ada galat yang muncul -- cuma centang yang
 * berpindah sendiri, pada halaman yang menentukan ke mana data apotek dikirim.
 */
function BarisCentang({
  untuk,
  label,
  checked,
  disabled,
  onChange,
  children,
}: {
  /** Subjek untuk pembaca layar -- tetap, walau `label`-nya berubah. */
  untuk: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </label>
      <Petunjuk untuk={untuk}>{children}</Petunjuk>
    </div>
  );
}

export function TargetTable({
  targets,
  grup,
  waSiap,
}: {
  targets: TargetRow[];
  grup: GrupRow[];
  waSiap: boolean;
}) {
  const [menambah, setMenambah] = useState(false);
  const [menyunting, setMenyunting] = useState<TargetRow | null>(null);
  const [menghapus, setMenghapus] = useState<TargetRow | null>(null);
  const [pesan, setPesan] = useState<HasilForm>({});
  const [pending, start] = useTransition();

  function jalankan(fn: () => Promise<HasilForm>) {
    start(async () => setPesan(await fn()));
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tiap resep dikirim ke <span className="font-medium text-foreground">semua tujuan yang aktif</span>. Dua tujuan
          berarti dua pesan per resep.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !waSiap}
            title={waSiap ? undefined : 'WhatsApp belum tersambung'}
            onClick={() => jalankan(mintaSyncGrupAction)}
          >
            Muat daftar grup
          </Button>
          <Button variant="primary" size="sm" onClick={() => setMenambah(true)}>
            Tambah tujuan
          </Button>
        </div>
      </div>

      {/* Pesan hasil dinaikkan ke HALAMAN, bukan ditinggal di dalam modal.
          "Kirim uji" dan "Nonaktifkan" tidak mengubah apa pun yang tampak di
          tabel, jadi tindakan yang berhasil tanpa pesan terbaca persis sama
          seperti tindakan yang gagal diam-diam. */}
      {pesan.error && <p className="mb-3 text-sm text-destructive">{pesan.error}</p>}
      {pesan.sukses && <p className="mb-3 text-sm text-success">{pesan.sukses}</p>}

      {targets.length === 0 ? (
        <EmptyState
          icon={<IconPill className="h-6 w-6" />}
          title="Belum ada tujuan"
          action={
            <Button variant="primary" size="sm" onClick={() => setMenambah(true)}>
              Tambah tujuan pertama
            </Button>
          }
        >
          Tanpa tujuan, tidak ada notifikasi apotek yang dikirim ke mana pun — walau sakelarnya menyala.
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
                <th className={`${cellClass} hidden md:table-cell`}>Boleh / menerima</th>
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
                  {/* SATU kolom untuk SELURUH centang, bukan satu kolom
                      masing-masing.

                      Tiap kolom `farmasi_target` menjawab pertanyaan yang
                      berbeda dan tetap terpisah DI DATABASE (lihat migrations
                      020/021/028/030/031) -- yang digabung di sini cuma
                      tempatnya di layar. Sebabnya terukur: satu kolom per
                      centang membuat yang ketiga tersembunyi di bawah `xl` dan
                      yang keempat praktis tidak pernah terlihat sama sekali,
                      sehingga pilihan yang sengaja dipisah di database berakhir
                      sebagai pilihan yang tidak bisa dijangkau siapa pun --
                      persis "pilihan yang hilang" yang jadi alasan
                      pemisahannya.

                      Bentuk ini pula yang membuat centang demi centang tidak
                      menambah satu masalah tata letak pun: yang tumbuh adalah
                      tinggi satu sel, bukan lebar tabelnya. Kalau suatu saat
                      terlalu tinggi, yang benar adalah memindahkannya ke modal
                      per baris -- bukan kembali ke satu kolom per centang. */}
                  <td className={`${cellClass} hidden md:table-cell`}>
                    <div className="flex flex-col gap-1">
                      <BarisCentang
                        untuk="Boleh tanya"
                        label={`Boleh tanya${t.bolehTanya && t.jenis === 'grup' ? ' (dijawab di grup)' : ''}`}
                        checked={t.bolehTanya}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleBolehTanyaAction(t.id, !t.bolehTanya))}
                      >
                        Boleh membuat nomor rumah sakit <strong>menjawab</strong> pertanyaan stok dan harga obat dari
                        alamat ini. Terpisah dari centang lain: sebuah grup sangat wajar cuma menerima pemberitahuan
                        tanpa nomor rumah sakit ikut bicara di dalamnya.
                      </BarisCentang>
                      <BarisCentang
                        untuk="Darurat stok"
                        label="Darurat stok"
                        checked={t.terimaDaruratStok}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleTerimaDaruratAction(t.id, !t.terimaDaruratStok))}
                      >
                        Menerima rekap barang yang stoknya sudah menyentuh ambang minimal, pada jam yang dijadwalkan.
                        Isinya keadaan gudang — <strong>tidak menyebut satu pun pasien</strong>.
                      </BarisCentang>
                      <BarisCentang
                        untuk="Pengadaan"
                        label="Pengadaan"
                        checked={t.terimaPengadaan}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleTerimaPengadaanAction(t.id, !t.terimaPengadaan))}
                      >
                        Menerima nota pembelian langsung dari pemasok, <strong>termasuk harga beli</strong> — angka yang
                        punya nilai dagang tersendiri. Dipisah dari centang lain justru supaya grup shift apotek bisa
                        menerima pemberitahuan resep tanpa ikut membaca harga.
                      </BarisCentang>
                      <BarisCentang
                        untuk="Hibah"
                        label="Hibah"
                        checked={t.terimaHibah}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleTerimaHibahAction(t.id, !t.terimaHibah))}
                      >
                        Menerima nota barang yang diterima sebagai hibah, berikut nilainya dan{' '}
                        <strong>nama pemberinya</strong>. Terpisah dari Pengadaan karena batas kerahasiaannya berbeda:
                        harga pemasok wajar dibatasi, nilai barang pemberian justru sering perlu dilihat lebih luas.
                      </BarisCentang>
                      <BarisCentang
                        untuk="Pemesanan"
                        label="Pemesanan"
                        checked={t.terimaPemesanan}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleTerimaPemesananAction(t.id, !t.terimaPemesanan))}
                      >
                        Menerima nota pesanan yang dikirim ke pemasok — <strong>barangnya belum datang</strong>. Ini
                        ujung yang lain dari Pengadaan, bukan penggantinya: yang ini berbunyi saat pesanan dikirim, yang
                        itu saat barangnya diterima.
                      </BarisCentang>
                      <BarisCentang
                        untuk="Penjualan"
                        label="Penjualan"
                        checked={t.terimaPenjualan}
                        disabled={pending}
                        onChange={() => jalankan(() => toggleTerimaPenjualanAction(t.id, !t.terimaPenjualan))}
                      >
                        Menerima nota penjualan apotek, dan kabar saat sebuah nota dibatalkan.{' '}
                        <strong>Jauh lebih ramai daripada nota barang lain — 16–46 pesan per hari</strong>, berbanding
                        sekitar 2 untuk pengadaan.
                      </BarisCentang>
                    </div>
                  </td>
                  <td className={cellClass}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="secondary"
                        size="xs"
                        disabled={pending || !waSiap}
                        title={waSiap ? 'Kirim satu pesan uji ke tujuan ini' : 'WhatsApp belum tersambung'}
                        onClick={() => jalankan(() => kirimUjiAction(t.id))}
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
                        onClick={() => jalankan(() => toggleTargetAction(t.id, !t.isActive))}
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

      {menambah && (
        <TargetModal
          key="baru"
          target={null}
          grup={grup}
          onClose={() => setMenambah(false)}
          onSukses={(m) => setPesan({ sukses: m })}
        />
      )}
      {menyunting && (
        <TargetModal
          key={menyunting.id}
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
            <span className="font-medium text-foreground">tidak menerima notifikasi apotek lagi</span>. Kalau cuma ingin
            menghentikannya sementara, pakai Nonaktifkan.
          </>
        }
        onConfirm={() => {
          const id = menghapus?.id;
          if (id === undefined) return;
          start(async () => {
            setPesan(await hapusTargetAction(id));
            setMenghapus(null);
          });
        }}
      />
    </>
  );
}

function TargetModal({
  target,
  grup,
  onClose,
  onSukses,
}: {
  target: TargetRow | null;
  grup: GrupRow[];
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const [jenis, setJenis] = useState<'grup' | 'personal'>(target?.jenis ?? 'grup');
  const [nilai, setNilai] = useState('');

  const [state, formAction, isPending] = useActionState(async (prev: HasilForm, formData: FormData) => {
    const hasil = target ? await ubahTargetAction(target.id, formData) : await tambahTargetAction(prev, formData);
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
          : 'Ke mana notifikasi apotek dikirim.'
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
                    Daftar grup belum pernah dimuat. Tekan{' '}
                    <span className="font-medium">&ldquo;Muat daftar grup&rdquo;</span> di atas, tunggu beberapa detik,
                    lalu muat ulang halaman ini. Nomor WhatsApp rumah sakit harus sudah menjadi anggota grupnya.
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
                  Terisi sendiri saat grup dipilih di atas. Boleh juga ditempel langsung bila kodenya sudah diketahui —
                  tapi <span className="font-medium">tautan undangan</span> (chat.whatsapp.com/…) bukan kode grup dan
                  tidak bisa dipakai.
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
                  Nomor pribadi petugas apotek. Ia akan menerima data pasien di WhatsApp pribadinya — pastikan itu
                  memang yang dikehendaki.
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
