'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button, Input, Select, MessageEditor, Badge, Modal, ConfirmDialog, EmptyState } from '@/components/ui';
import { tableWrapperClass, theadClass, rowClass, cellClass } from '@/components/ui';
import { DARURAT_TEMPLATE_VARIABLES } from '@/core/template';
import { MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS, type RepeatKindPeriodik } from '@/core/schedule';
// Dari `core/`, BUKAN dari runner-nya: runner menarik `khanza/*` yang berujung
// ke koneksi database, dan berkas ini komponen klien -- pelajaran yang sama
// dengan `WindowModeFields` di /broadcast-terjadwal.
import { BATAS_KERAS_BARIS } from '@/core/stokDarurat';
import {
  simpanPesanDaruratAction,
  pratinjauDaruratAction,
  simpanJadwalAction,
  toggleJadwalAction,
  hapusJadwalAction,
  kirimSekarangAction,
  ujiFrasaDaruratAction,
  type HasilDarurat,
  type HasilPratinjau,
  type HasilUjiFrasa,
} from './daruratActions';

export interface JadwalRow {
  id: number;
  nama: string;
  repeatKind: RepeatKindPeriodik;
  intervalDays: number | null;
  timeOfDay: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  kdJenis: string | null;
  namaJenis: string;
  maxBaris: number;
  isActive: boolean;
  /** Sudah diformat di SERVER: toLocaleString di klien memberi hasil berbeda antara render server dan klien, dan React melaporkannya sebagai hydration mismatch. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastJumlah: number | null;
}

export interface JenisOption {
  kdjns: string;
  nama: string;
  jumlah: number;
}

export interface NilaiDarurat {
  template: string;
  templateKosong: string;
  pakaiBatch: boolean;
  bolehTanya: boolean;
  frasa: string;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Pengulangan dijelaskan lewat AKIBATNYA, bukan nama teknisnya.
 *
 * "every_n_days" tidak memberi tahu siapa pun bahwa 1 tidak diterima, dan
 * "monthly" tidak memberi tahu bahwa tanggalnya berhenti di 28.
 */
const PENGULANGAN: { nilai: RepeatKindPeriodik; judul: string }[] = [
  { nilai: 'daily', judul: 'Setiap hari' },
  { nilai: 'every_n_days', judul: 'Setiap beberapa hari' },
  { nilai: 'weekly', judul: 'Setiap minggu' },
  { nilai: 'monthly', judul: 'Setiap bulan' },
];

export function ringkasJadwal(j: JadwalRow): string {
  if (j.repeatKind === 'daily') return `Tiap hari ${j.timeOfDay}`;
  if (j.repeatKind === 'every_n_days') return `Tiap ${j.intervalDays} hari, ${j.timeOfDay}`;
  if (j.repeatKind === 'weekly') return `Tiap ${HARI[j.dayOfWeek ?? 0]} ${j.timeOfDay}`;
  return `Tiap tanggal ${j.dayOfMonth}, ${j.timeOfDay}`;
}

export function DaruratForm({
  nilai,
  jadwal,
  jenis,
  adaTujuan,
}: {
  nilai: NilaiDarurat;
  jadwal: JadwalRow[];
  jenis: JenisOption[];
  adaTujuan: boolean;
}) {
  const [pesanState, pesanAction, pesanPending] = useActionState(
    async (prev: HasilDarurat, fd: FormData) => simpanPesanDaruratAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjau, fd: FormData) => pratinjauDaruratAction(prev, fd),
    {},
  );
  const [uji, ujiAction, ujiPending] = useActionState(
    async (prev: HasilUjiFrasa, fd: FormData) => ujiFrasaDaruratAction(prev, fd),
    {},
  );

  const [menyunting, setMenyunting] = useState<JadwalRow | null>(null);
  const [membuat, setMembuat] = useState(false);
  const [menghapus, setMenghapus] = useState<JadwalRow | null>(null);
  const [pesanBaris, setPesanBaris] = useState<HasilDarurat>({});
  const [pending, mulai] = useTransition();

  function jalankan(fn: () => Promise<HasilDarurat>) {
    mulai(async () => setPesanBaris(await fn()));
  }

  const dialogTerbuka = membuat || menyunting !== null;

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima peringatan ini.</span> Centang &ldquo;Terima
          darurat stok&rdquo; pada salah satu tujuan di tabel &ldquo;Tujuan pengiriman&rdquo; di atas. Selama belum
          dicentang, jadwal yang jatuh tempo tidak mengirim ke mana pun.
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Isi pesan                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pesanAction} className="space-y-3">
        <MessageEditor
          name="template_darurat"
          defaultValue={nilai.template}
          variables={DARURAT_TEMPLATE_VARIABLES}
          rows={7}
          disabled={pesanPending}
          hint="Daftar barangnya dirakit sistem dan dipasang ke {daftar_stok} — nama barang, sisa, dan ambang minimalnya."
        />

        <div>
          <label className="mb-1 block text-xs font-medium">
            Pesan saat tidak ada barang di bawah ambang{' '}
            <span className="font-normal text-muted-foreground">(kosongkan = tidak mengirim apa-apa)</span>
          </label>
          <MessageEditor
            name="template_darurat_kosong"
            defaultValue={nilai.templateKosong}
            variables={DARURAT_TEMPLATE_VARIABLES}
            rows={3}
            disabled={pesanPending}
            hint="Dibiarkan kosong secara bawaan. Peringatan harian yang isinya “tidak ada apa-apa” berhenti dibaca dalam seminggu — dan sejak itu yang sungguhan ikut tidak terbaca."
          />
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-xs">
          <input type="checkbox" name="stok_pakai_batch" defaultChecked={nilai.pakaiBatch} disabled={pesanPending} />
          <span>
            <span className="font-medium">Apotek ini memakai penomoran batch di Khanza.</span>
            <span className="block text-muted-foreground">
              Menentukan cara stok dijumlahkan, dan berlaku juga untuk balasan stok &amp; harga di atas. Salah menyetel
              tidak menghasilkan pesan galat — yang terjadi, seluruh katalog terbaca berstok nol. Periksa lewat tombol
              &ldquo;Lihat daftar sekarang&rdquo; di bawah bila ragu.
            </span>
          </span>
        </label>

        <div className="rounded-md border border-border/60 p-3">
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" name="darurat_tanya" defaultChecked={nilai.bolehTanya} disabled={pesanPending} />
            <span>
              <span className="font-medium">Jawab bila ditanya.</span>
              <span className="block text-muted-foreground">
                Petugas atau grup yang dicentang &ldquo;Boleh tanya&rdquo; bisa meminta rekap ini kapan saja lewat
                WhatsApp, di luar jadwal. <span className="font-medium">Wajib terdaftar</span> — berbeda dari balasan
                stok satu obat, rekap ini tidak pernah dibuka untuk umum sekalipun mode stok disetel
                &ldquo;semua&rdquo;: isinya daftar kekurangan gudang, bukan daftar harga.
              </span>
            </span>
          </label>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium">Frasa pertanyaan</label>
            <Input
              name="darurat_keywords"
              defaultValue={nilai.frasa}
              disabled={pesanPending}
              placeholder="darurat stok,stok menipis,rekap stok"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Dipisah koma, dicocokkan sebagai frasa utuh. Sengaja bukan kata tunggal seperti &ldquo;stok&rdquo; — itu
              milik balasan stok satu obat di atas, dan memakainya di sini membuat setiap pertanyaan tentang satu obat
              dijawab daftar ratusan barang. Pesan yang masih menyebut nama obat (&ldquo;stok habis paracetamol&rdquo;)
              tetap diteruskan ke sana.
            </p>
          </div>
        </div>

        {pesanState.error && <p className="text-xs text-destructive">{pesanState.error}</p>}
        {pesanState.sukses && <p className="text-xs text-success">{pesanState.sukses}</p>}
        <Button type="submit" disabled={pesanPending}>
          {pesanPending ? 'Menyimpan...' : 'Simpan isi pesan'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Uji coba frasa                                                     */}
      {/* ------------------------------------------------------------------ */}
      <form action={ujiAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 text-xs font-medium">Uji coba frasa</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Memakai pencocokan yang sama persis dipakai worker, atas frasa yang SUDAH tersimpan. Tidak mengirim apa pun.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Input name="uji_teks" placeholder="stok apa saja yang menipis?" className="w-72" fieldSize="sm" />
          <Button type="submit" variant="secondary" disabled={ujiPending}>
            {ujiPending ? 'Memeriksa...' : 'Periksa'}
          </Button>
        </div>
        {uji.error && <p className="mt-2 text-xs text-destructive">{uji.error}</p>}
        {uji.cocok === true && (
          <p className="mt-2 text-xs text-success">
            Dijawab dengan rekap persediaan (frasa: <span className="font-mono">{uji.frasa}</span>).
          </p>
        )}
        {uji.cocok === false && (
          <p className="mt-2 text-xs text-muted-foreground">
            {uji.frasa
              ? `Frasa "${uji.frasa}" memang cocok, tapi pesannya masih menyebut "${uji.sisa}" — diteruskan ke balasan stok satu obat, bukan dijawab rekap.`
              : 'Tidak dibaca sebagai permintaan rekap. Pesannya diteruskan ke balasan stok, lalu ke aturan /balasan-otomatis.'}
          </p>
        )}
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 text-xs font-medium">Lihat daftar sekarang</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Membaca persediaan saat ini lewat jalur yang sama persis dipakai worker. Tidak mengirim apa pun.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs">Jenis barang</label>
            <Select name="kd_jenis" fieldSize="sm" defaultValue="">
              <option value="">Semua jenis</option>
              {jenis.map((j) => (
                <option key={j.kdjns} value={j.kdjns}>
                  {j.nama} ({j.jumlah})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs">Batas baris</label>
            <Input
              name="max_baris"
              type="number"
              min={0}
              max={BATAS_KERAS_BARIS}
              defaultValue={0}
              fieldSize="sm"
              className="w-24"
            />
            <p className="mt-1 text-xs text-muted-foreground">0 = semua</p>
          </div>
          <Button type="submit" variant="secondary" disabled={pratinjauPending}>
            {pratinjauPending ? 'Membaca...' : 'Lihat daftar sekarang'}
          </Button>
        </div>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}
        {pratinjau.teks && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{pratinjau.total}</span> barang di bawah ambang —{' '}
              {pratinjau.habis} habis, {pratinjau.menipis} menipis.
              {(pratinjau.jumlahPesan ?? 0) > 1 && (
                <span className="text-warning">
                  {' '}
                  Terlalu panjang untuk satu pesan WhatsApp — akan terkirim sebagai {pratinjau.jumlahPesan} pesan
                  berturut-turut, seluruh barangnya tetap ikut.
                </span>
              )}
              {pratinjau.diam && ' Tidak ada yang akan dikirim (pesan saat aman dibiarkan kosong).'}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
              {pratinjau.teks}
            </pre>
          </div>
        )}
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Jadwal                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium">Jadwal pengiriman</p>
          <Button size="sm" onClick={() => setMembuat(true)} disabled={pending}>
            Tambah jadwal
          </Button>
        </div>

        {pesanBaris.error && <p className="mb-2 text-xs text-destructive">{pesanBaris.error}</p>}
        {pesanBaris.sukses && <p className="mb-2 text-xs text-success">{pesanBaris.sukses}</p>}

        {jadwal.length === 0 ? (
          <EmptyState title="Belum ada jadwal">
            Tanpa jadwal, peringatan hanya terkirim saat ditekan manual. Tambahkan satu — mis. tiap hari pukul 07.00.
          </EmptyState>
        ) : (
          <div className={tableWrapperClass}>
            <table className="w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className={`${cellClass} whitespace-nowrap`}>Nama</th>
                  <th className={`${cellClass} whitespace-nowrap`}>Pengulangan</th>
                  <th className={`${cellClass} hidden md:table-cell`}>Jenis</th>
                  <th className={`${cellClass} hidden lg:table-cell whitespace-nowrap`}>Berikutnya</th>
                  <th className={`${cellClass} hidden lg:table-cell whitespace-nowrap`}>Terakhir</th>
                  <th className={cellClass}>Status</th>
                  <th className={`${cellClass} w-px`}></th>
                </tr>
              </thead>
              <tbody>
                {jadwal.map((j) => (
                  <tr key={j.id} className={rowClass}>
                    <td className={`${cellClass} font-medium`}>{j.nama}</td>
                    <td className={`${cellClass} whitespace-nowrap`}>{ringkasJadwal(j)}</td>
                    <td className={`${cellClass} hidden md:table-cell text-muted-foreground`}>
                      {j.kdJenis ? j.namaJenis : 'Semua'}
                    </td>
                    <td className={`${cellClass} hidden lg:table-cell whitespace-nowrap text-xs text-muted-foreground`}>
                      {j.nextRunAt ?? '—'}
                    </td>
                    <td className={`${cellClass} hidden lg:table-cell whitespace-nowrap text-xs text-muted-foreground`}>
                      {j.lastRunAt ? `${j.lastRunAt} (${j.lastJumlah ?? 0})` : 'belum pernah'}
                    </td>
                    <td className={cellClass}>
                      <Badge variant={j.isActive ? 'success' : 'neutral'}>{j.isActive ? 'Aktif' : 'Dijeda'}</Badge>
                    </td>
                    <td className={cellClass}>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={pending || !adaTujuan}
                          title={adaTujuan ? 'Jalankan sekarang, di luar jadwalnya' : 'Belum ada tujuan yang menerima'}
                          onClick={() => jalankan(() => kirimSekarangAction(j.id))}
                        >
                          Kirim sekarang
                        </Button>
                        <Button variant="secondary" size="xs" disabled={pending} onClick={() => setMenyunting(j)}>
                          Ubah
                        </Button>
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={pending}
                          onClick={() => jalankan(() => toggleJadwalAction(j.id, !j.isActive))}
                        >
                          {j.isActive ? 'Jeda' : 'Aktifkan'}
                        </Button>
                        <Button variant="destructive" size="xs" disabled={pending} onClick={() => setMenghapus(j)}>
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
      </div>

      <JadwalDialog
        open={dialogTerbuka}
        jadwal={menyunting}
        jenis={jenis}
        onClose={() => {
          setMembuat(false);
          setMenyunting(null);
        }}
      />

      <ConfirmDialog
        open={menghapus !== null}
        onClose={() => setMenghapus(null)}
        onConfirm={() => {
          const target = menghapus;
          setMenghapus(null);
          if (target) jalankan(() => hapusJadwalAction(target.id));
        }}
        title="Hapus jadwal ini?"
        message={
          menghapus
            ? `"${menghapus.nama}" akan dihapus permanen. Peringatan persediaan berhenti terkirim menurut jadwal ini.`
            : ''
        }
        pending={pending}
      />
    </div>
  );
}

/**
 * Form tambah/ubah di dalam `<dialog>` asli lewat `Modal`.
 *
 * `key` pada form memaksa React membangun ulang seluruh isinya saat jadwal yang
 * disunting berganti -- tanpa itu `defaultValue` milik input tak terkendali
 * tidak ikut berubah, dan staf menyunting jadwal B sambil melihat isi jadwal A.
 */
function JadwalDialog({
  open,
  jadwal,
  jenis,
  onClose,
}: {
  open: boolean;
  jadwal: JadwalRow | null;
  jenis: JenisOption[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(async (prev: HasilDarurat, fd: FormData) => {
    const hasil = await simpanJadwalAction(prev, fd);
    if (hasil.sukses) onClose();
    return hasil;
  }, {});

  const [kind, setKind] = useState<RepeatKindPeriodik>(jadwal?.repeatKind ?? 'daily');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={jadwal ? 'Ubah jadwal' : 'Tambah jadwal'}
      description="Peringatan dikirim ke semua tujuan yang mencentang “Terima darurat stok”."
    >
      <form key={jadwal?.id ?? 'baru'} action={action} className="space-y-3">
        {jadwal && <input type="hidden" name="id" value={jadwal.id} />}

        <div>
          <label className="mb-1 block text-xs font-medium">Nama jadwal</label>
          <Input name="nama" defaultValue={jadwal?.nama ?? ''} placeholder="Rekap pagi grup apotek" maxLength={80} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Pengulangan</label>
            <Select
              name="repeat_kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as RepeatKindPeriodik)}
            >
              {PENGULANGAN.map((p) => (
                <option key={p.nilai} value={p.nilai}>
                  {p.judul}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Jam kirim</label>
            <Input name="time_of_day" type="time" defaultValue={jadwal?.timeOfDay ?? '07:00'} />
          </div>
        </div>

        {kind === 'every_n_days' && (
          <div>
            <label className="mb-1 block text-xs font-medium">Setiap berapa hari</label>
            <Input
              name="interval_days"
              type="number"
              min={MIN_INTERVAL_DAYS}
              max={MAX_INTERVAL_DAYS}
              defaultValue={jadwal?.intervalDays ?? 3}
              className="w-28"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {MIN_INTERVAL_DAYS}–{MAX_INTERVAL_DAYS} hari. Untuk tiap hari, pilih &ldquo;Setiap hari&rdquo;.
            </p>
          </div>
        )}

        {kind === 'weekly' && (
          <div>
            <label className="mb-1 block text-xs font-medium">Hari</label>
            <Select name="day_of_week" defaultValue={String(jadwal?.dayOfWeek ?? 1)}>
              {HARI.map((h, i) => (
                <option key={h} value={i}>
                  {h}
                </option>
              ))}
            </Select>
          </div>
        )}

        {kind === 'monthly' && (
          <div>
            <label className="mb-1 block text-xs font-medium">Tanggal</label>
            <Input
              name="day_of_month"
              type="number"
              min={1}
              max={28}
              defaultValue={jadwal?.dayOfMonth ?? 1}
              className="w-28"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              1–28, supaya tanggalnya tetap ada di setiap bulan termasuk Februari.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Jenis barang</label>
            <Select name="kd_jenis" defaultValue={jadwal?.kdJenis ?? ''}>
              <option value="">Semua jenis</option>
              {jenis.map((j) => (
                <option key={j.kdjns} value={j.kdjns}>
                  {j.nama} ({j.jumlah})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Batas baris</label>
            <Input name="max_baris" type="number" min={0} max={BATAS_KERAS_BARIS} defaultValue={jadwal?.maxBaris ?? 0} />
            <p className="mt-1 text-xs text-muted-foreground">
              0 = seluruh barang yang di bawah ambang. Daftar yang terlalu panjang untuk satu pesan WhatsApp dipecah
              jadi beberapa pesan berturut-turut — tidak ada barang yang dibuang.
            </p>
          </div>
        </div>

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
