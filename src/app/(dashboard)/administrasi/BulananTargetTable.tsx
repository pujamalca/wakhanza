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
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { tampilkanChatId } from '@/core/farmasiTarget';
import {
  tambahTargetAction,
  hapusTargetAction,
  toggleTargetAction,
  syncGrupAction,
  type HasilBulanan,
} from './bulananActions';

export interface TargetBulananRow {
  id: number;
  jenis: 'grup' | 'personal';
  chatId: string;
  label: string;
  isActive: boolean;
  terimaBulanan: boolean;
}

export interface GrupRow {
  chatId: string;
  nama: string;
}

/**
 * Daftar tujuan rekap bulanan administrasi.
 *
 * Tabel TERSENDIRI (`administrasi_target`), dan yang layak disadari saat
 * membacanya: halaman ini sampai migrations/047 TIDAK PUNYA daftar tujuan sama
 * sekali. Kesembilan kelas pemicunya berujung ke nomor seorang PASIEN yang datang
 * dari `sik`, jadi tidak pernah ada yang perlu dipilih staf. Ini penerima STAF
 * pertama di halaman ini, dan itu pula sebabnya keterangannya menyebut bedanya
 * alih-alih mengandalkan pembacanya menebak.
 *
 * Tombol uji TIDAK ada per baris, berbeda dari `/erm` dan `/farmasi`. Rekapnya
 * satu pesan yang sama ke seluruh tujuan sekaligus, jadi tombolnya tinggal satu
 * di bawah form -- menaruhnya per baris menyiratkan tiap tujuan bisa diuji
 * sendiri-sendiri padahal isinya identik.
 */
export function BulananTargetTable({
  targets,
  grup,
  waSiap,
}: {
  targets: TargetBulananRow[];
  grup: GrupRow[];
  waSiap: boolean;
}) {
  const [menambah, setMenambah] = useState(false);
  const [menghapus, setMenghapus] = useState<TargetBulananRow | null>(null);
  const [pesan, setPesan] = useState<HasilBulanan>({});
  const [pending, start] = useTransition();
  const [hasilTambah, aksiTambah] = useActionState(tambahTargetAction, {} as HasilBulanan);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          Tujuan <span className="font-medium text-foreground">Nonaktif</span> tidak menerima apa pun, apa pun
          centangnya. Daftar ini <span className="font-medium text-foreground">terpisah</span> dari tujuan Apotek, BPJS,
          dan ERM &mdash; alamat yang sama boleh ada di beberapa daftar sekaligus.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !waSiap}
            title={waSiap ? undefined : 'WhatsApp belum tersambung'}
            onClick={() => start(async () => setPesan(await syncGrupAction()))}
          >
            Muat daftar grup
          </Button>
          <Button variant="primary" size="sm" onClick={() => setMenambah(true)}>
            Tambah tujuan
          </Button>
        </div>
      </div>

      {(pesan.error || pesan.sukses) && (
        <p className={`mb-3 text-label ${pesan.error ? 'text-destructive' : 'text-success'}`}>
          {pesan.error ?? pesan.sukses}
        </p>
      )}

      {targets.length === 0 ? (
        <EmptyState
          title="Belum ada tujuan"
          action={
            <Button variant="primary" size="sm" onClick={() => setMenambah(true)}>
              Tambah tujuan
            </Button>
          }
        >
          Rekap perlu tahu ke mana harus dikirim. Tambahkan grup manajemen/rekam medis atau nomor petugasnya.
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-left text-body">
            <thead className={theadClass}>
              <tr>
                <th className={cellClass}>Tujuan</th>
                <th className={`${cellClass} hidden md:table-cell`}>Alamat</th>
                <th className={cellClass}>Status</th>
                <th className={cellClass}>
                  <span className="inline-flex items-center gap-1">
                    Terima rekap bulanan
                    <Petunjuk untuk="arti centang terima rekap bulanan">
                      Centang ini <strong>terpisah</strong> dari kolom Status di sebelahnya, dan keduanya harus menyala
                      supaya rekapnya sampai. Status menjawab &ldquo;tujuan ini masih dipakai&rdquo;; centang ini
                      menjawab &ldquo;tujuan ini menerima rekap bulanan&rdquo;.
                      <br />
                      <br />
                      Tujuan yang baru ditambahkan selalu belum tercentang &mdash; memperketat dengan sengaja. Isinya
                      memang angka, tapi angka itu mencakup kelengkapan berkas dan closing billing: bacaan manajemen,
                      bukan bacaan shift.
                    </Petunjuk>
                  </span>
                </th>
                <th className={cellClass} />
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className={rowClass}>
                  <td className={cellClass}>
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-2 text-caption text-muted-foreground">
                      {t.jenis === 'grup' ? 'Grup' : 'Nomor'}
                    </span>
                  </td>
                  <td className={`${cellClass} hidden font-mono text-caption text-muted-foreground md:table-cell`}>
                    {tampilkanChatId(t.chatId)}
                  </td>
                  <td className={cellClass}>
                    {/*
                      Tombol keterangan BERSAUDARA dengan label, tidak pernah di
                      dalamnya: apa pun yang diklik di dalam <label> ikut
                      menyalakan kontrolnya, jadi menekan ikon keterangan akan
                      mengubah setelan yang artinya baru saja hendak ditanyakan.
                    */}
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={t.isActive}
                        disabled={pending}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          start(() => {
                            void toggleTargetAction(t.id, 'aktif', v);
                          });
                        }}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                    </label>
                  </td>
                  <td className={cellClass}>
                    <input
                      type="checkbox"
                      aria-label={`Terima rekap bulanan untuk ${t.label}`}
                      checked={t.terimaBulanan}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.currentTarget.checked;
                        start(() => {
                          void toggleTargetAction(t.id, 'bulanan', v);
                        });
                      }}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <Button variant="ghost" size="xs" onClick={() => setMenghapus(t)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={menambah} onClose={() => setMenambah(false)} title="Tambah tujuan rekap bulanan" size="lg">
        <form action={aksiTambah} className="space-y-3">
          <div>
            <label htmlFor="adm-jenis" className="mb-1 block text-label">
              Jenis
            </label>
            <Select id="adm-jenis" name="jenis" fieldSize="md" defaultValue="grup">
              <option value="grup">Grup WhatsApp</option>
              <option value="personal">Nomor petugas</option>
            </Select>
          </div>

          <div>
            <label htmlFor="adm-nilai" className="mb-1 block text-label">
              Alamat
            </label>
            <Input
              id="adm-nilai"
              name="nilai"
              fieldSize="md"
              placeholder="120363xxxxxxxxxxxx@g.us atau 08xxxxxxxxxx"
            />
            <p className="mt-1 text-caption text-muted-foreground">
              Kode grup tidak bisa dilihat dari aplikasi WhatsApp. Tekan <strong>Muat daftar grup</strong> lalu salin
              dari daftar di bawah &mdash; tautan undangan (chat.whatsapp.com/…) bukan kode grup dan tidak bisa dipakai.
            </p>
          </div>

          <div>
            <label htmlFor="adm-label" className="mb-1 block text-label">
              Label
            </label>
            <Input id="adm-label" name="label" fieldSize="md" placeholder="Grup Manajemen" />
          </div>

          {hasilTambah.error && <p className="text-label text-destructive">{hasilTambah.error}</p>}
          {hasilTambah.sukses && <p className="text-label text-success">{hasilTambah.sukses}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setMenambah(false)}>
              Tutup
            </Button>
            <Button type="submit" variant="primary">
              Tambah
            </Button>
          </div>
        </form>

        {grup.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-label">Grup yang diikuti nomor RS</p>
            <ul className="space-y-1 text-caption">
              {grup.map((g) => (
                <li key={g.chatId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{g.nama}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{g.chatId}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={menghapus !== null}
        onClose={() => setMenghapus(null)}
        onConfirm={() => {
          const t = menghapus;
          setMenghapus(null);
          if (t) start(() => void hapusTargetAction(t.id));
        }}
        title="Hapus tujuan"
        message={
          <>
            Tujuan <strong>{menghapus?.label}</strong> dihapus permanen. Rekap berikutnya tidak lagi dikirim ke sana.
            Pesan yang sudah terlanjur masuk antrean tetap terkirim.
          </>
        }
        pending={pending}
      />
    </>
  );
}
