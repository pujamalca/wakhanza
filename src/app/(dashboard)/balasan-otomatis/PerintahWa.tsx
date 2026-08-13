'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Petunjuk,
  Select,
  cellClass,
  rowClass,
  tableWrapperClass,
  theadClass,
} from '@/components/ui';
import {
  tambahAdminPerintahAction,
  hapusAdminPerintahAction,
  toggleAdminPerintahAction,
  togglePerintahWaAction,
  toggleAktifLangsungAction,
  syncGrupPerintahAction,
  type HasilPerintahForm,
} from './actions';

export interface BarisAdmin {
  id: number;
  chatId: string;
  label: string;
  isActive: boolean;
}

export interface PilihanGrup {
  chatId: string;
  nama: string;
  jumlahPeserta: number | null;
}

interface Props {
  aktif: boolean;
  aktifLangsung: boolean;
  timeoutMenit: number;
  admin: BarisAdmin[];
  grup: PilihanGrup[];
}

export function PerintahWa({ aktif, aktifLangsung, timeoutMenit, admin, grup }: Props) {
  return (
    <section className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title">Perintah lewat WhatsApp</h2>
        <Badge variant={aktif ? 'success' : 'warning'}>{aktif ? 'Menyala' : 'Mati'}</Badge>
      </div>

      <SakelarUtama aktif={aktif} adaAdmin={admin.some((a) => a.isActive)} />

      {aktif && (
        <>
          <SakelarAktifLangsung nyala={aktifLangsung} />
          <DaftarAdmin admin={admin} grup={grup} timeoutMenit={timeoutMenit} />
        </>
      )}
    </section>
  );
}

/**
 * Sakelar utamanya, dan kalimatnya menyebut AKIBAT bukan nama fiturnya.
 *
 * Peringatan "belum ada alamat yang berwenang" muncul justru saat sakelarnya
 * MENYALA: itu keadaan salah setel yang bergejala persis seperti yang benar --
 * halaman tampak wajar, dan tidak satu pun perintah pernah dijawab, karena
 * alamat yang tidak terdaftar memang sengaja didiamkan.
 */
function SakelarUtama({ aktif, adaAdmin }: { aktif: boolean; adaAdmin: boolean }) {
  const [pending, start] = useTransition();

  return (
    <Callout variant={aktif ? 'privasi' : 'neutral'} title="Menulis aturan balasan lewat chat WhatsApp">
      <p>
        Staf yang alamatnya terdaftar di bawah bisa mengetik <code>/tambah-jawaban-otomatis</code> ke nomor rumah sakit,
        lalu dituntun mengisi nama aturan, kata kunci, dan isi balasan. Tersedia juga <code>/daftar</code>,{' '}
        <code>/ubah</code>, <code>/hapus</code>, <code>/uji</code>, dan <code>/batal</code>.
      </p>
      <p className="mt-2">
        Ini satu-satunya jalur yang bisa <span className="font-medium">mengubah apa yang dikatakan nomor rumah sakit
        kepada pasien</span> tanpa lewat halaman ini. Alamat yang tidak terdaftar didiamkan — pesannya diperlakukan
        seperti pesan biasa, tanpa pemberitahuan bahwa perintah semacam ini ada.
      </p>

      {aktif && !adaAdmin && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-caption">
          <span className="font-medium">Belum ada alamat yang berwenang.</span> Selama daftar di bawah kosong, tidak satu
          pun perintah akan dijawab — dan itu terlihat persis seperti fitur yang rusak.
        </p>
      )}

      <div className="mt-3">
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() => start(() => void togglePerintahWaAction(!aktif))}
        >
          {pending ? 'Menyimpan...' : aktif ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>
    </Callout>
  );
}

/**
 * Keputusan kedua, dan yang paling menentukan di halaman ini. Sengaja BUKAN
 * tombol polos: kedua pilihannya sah, dan yang membedakannya bukan aman-vs-tidak
 * melainkan siapa yang meninjau. Kalimatnya karena itu menyebutkan keduanya apa
 * adanya alih-alih menandai salah satunya sebagai benar.
 */
function SakelarAktifLangsung({ nyala }: { nyala: boolean }) {
  const [pending, start] = useTransition();

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title-sm">Aturan baru dari WhatsApp</h3>
            <Badge variant={nyala ? 'warning' : 'success'}>{nyala ? 'Langsung aktif' : 'Perlu ditinjau'}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {nyala ? (
              <>
                Aturan yang selesai dibuat lewat chat <span className="font-medium">langsung menjawab pasien</span>, tanpa
                ada yang meninjau isinya lebih dulu.
              </>
            ) : (
              <>
                Aturan yang selesai dibuat lewat chat tersimpan <span className="font-medium">nonaktif</span>. Aturan itu
                baru menjawab pasien setelah dicentang aktif di tabel Aturan di bawah.
              </>
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          disabled={pending}
          onClick={() => start(() => void toggleAktifLangsungAction(!nyala))}
        >
          {pending ? 'Menyimpan...' : nyala ? 'Wajibkan ditinjau' : 'Jadikan langsung aktif'}
        </Button>
      </div>
    </Card>
  );
}

function DaftarAdmin({
  admin,
  grup,
  timeoutMenit,
}: {
  admin: BarisAdmin[];
  grup: PilihanGrup[];
  timeoutMenit: number;
}) {
  const [hasil, kirim, pending] = useActionState<HasilPerintahForm, FormData>(tambahAdminPerintahAction, {});
  const [jenis, setJenis] = useState<'grup' | 'personal'>('personal');
  const [pesanBaris, setPesanBaris] = useState<HasilPerintahForm>({});
  const [hapus, setHapus] = useState<BarisAdmin | null>(null);
  const [pendingBaris, startBaris] = useTransition();
  const [pendingSync, startSync] = useTransition();

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-title-sm">Alamat yang berwenang</h3>
        <Petunjuk untuk="alamat yang berwenang menjalankan perintah">
          Daftar ini TERPISAH dari tujuan apotek di halaman Farmasi. &quot;Boleh menanyakan stok&quot; dan &quot;boleh
          mengubah apa yang dikatakan rumah sakit kepada pasien&quot; adalah dua wewenang yang berbeda beratnya, jadi
          mendaftar di sini tidak memberi wewenang di sana, dan sebaliknya.
        </Petunjuk>
      </div>

      <form action={kirim} className="mb-4 grid gap-2 sm:grid-cols-[9rem,1fr,1fr,auto]">
        <Select name="jenis" fieldSize="sm" value={jenis} onChange={(e) => setJenis(e.target.value as 'grup' | 'personal')}>
          <option value="personal">Nomor petugas</option>
          <option value="grup">Grup</option>
        </Select>

        {jenis === 'grup' ? (
          <Select name="nilai" fieldSize="sm" defaultValue="">
            <option value="" disabled>
              {grup.length > 0 ? 'Pilih grup...' : 'Belum ada daftar grup'}
            </option>
            {grup.map((g) => (
              <option key={g.chatId} value={g.chatId}>
                {g.nama}
                {g.jumlahPeserta !== null ? ` (${g.jumlahPeserta} anggota)` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <Input name="nilai" fieldSize="sm" placeholder="081234567890" />
        )}

        <Input name="label" fieldSize="sm" placeholder="Nama, mis. HP Kepala Rekam Medis" maxLength={80} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Menyimpan...' : 'Tambah'}
        </Button>
      </form>

      {jenis === 'grup' && (
        <p className="mb-3 text-caption text-muted-foreground">
          Kode grup tidak bisa disalin dari aplikasi WhatsApp — daftar di atas dibaca worker dari sesi yang sedang
          tersambung.{' '}
          <Button
            variant="ghost"
            size="xs"
            disabled={pendingSync}
            onClick={() => startSync(async () => setPesanBaris(await syncGrupPerintahAction()))}
          >
            {pendingSync ? 'Meminta...' : 'Muat daftar grup'}
          </Button>
        </p>
      )}

      {hasil.error && <p className="mb-3 text-sm text-destructive">{hasil.error}</p>}
      {hasil.sukses && <p className="mb-3 text-sm text-success">{hasil.sukses}</p>}
      {pesanBaris.error && <p className="mb-3 text-sm text-destructive">{pesanBaris.error}</p>}
      {pesanBaris.sukses && <p className="mb-3 text-sm text-success">{pesanBaris.sukses}</p>}

      {admin.length === 0 ? (
        <EmptyState title="Belum ada alamat yang berwenang">
          Tambahkan satu nomor petugas untuk mencobanya. Grup boleh dipakai, tapi ingat bahwa setiap anggotanya ikut
          mendapat wewenang yang sama.
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={cellClass}>Nama</th>
                <th className={`${cellClass} hidden md:table-cell`}>Alamat</th>
                <th className={cellClass}>Status</th>
                <th className={cellClass}>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {admin.map((a) => (
                <tr key={a.id} className={rowClass}>
                  <td className={cellClass}>{a.label}</td>
                  <td className={`${cellClass} hidden font-mono text-caption md:table-cell`}>{a.chatId}</td>
                  <td className={cellClass}>
                    <Badge variant={a.isActive ? 'success' : 'neutral'}>{a.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                  </td>
                  <td className={cellClass}>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pendingBaris}
                        onClick={() =>
                          startBaris(async () => setPesanBaris(await toggleAdminPerintahAction(a.id, !a.isActive)))
                        }
                      >
                        {a.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setHapus(a)}>
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

      <p className="mt-3 text-caption text-muted-foreground">
        Percakapan yang ditinggalkan di tengah kedaluwarsa sendiri setelah {timeoutMenit} menit
        {timeoutMenit === 0 ? ' (kedaluwarsa dimatikan — tidak dianjurkan)' : ''}, lalu pesan berikutnya kembali
        diperlakukan seperti pesan biasa.
      </p>

      <ConfirmDialog
        open={hapus !== null}
        title={`Keluarkan "${hapus?.label ?? ''}" dari daftar?`}
        confirmLabel="Hapus"
        pending={pendingBaris}
        message="Sesudah ini, perintah dari alamat tersebut tidak dijawab lagi. Aturan yang sudah terlanjur dibuatnya TIDAK ikut terhapus — kelola sendiri di tabel Aturan di bawah."
        onClose={() => setHapus(null)}
        onConfirm={() => {
          const target = hapus;
          setHapus(null);
          if (target) startBaris(async () => setPesanBaris(await hapusAdminPerintahAction(target.id)));
        }}
      />
    </Card>
  );
}
