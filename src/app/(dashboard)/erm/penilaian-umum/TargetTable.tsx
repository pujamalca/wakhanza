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
  kirimUjiAction,
  syncGrupAction,
  type HasilForm,
} from './actions';

export interface TargetRow {
  id: number;
  jenis: 'grup' | 'personal';
  chatId: string;
  label: string;
  isActive: boolean;
  /** Menerima rekap asesmen -- memuat nama pasien dan nomor rekam medis. */
  terimaPenilaianUmum: boolean;
}

export interface GrupRow {
  chatId: string;
  nama: string;
  jumlahPeserta: number | null;
}

export function TargetTable({
  targets,
  grup,
  waSiap,
  tanggal,
}: {
  targets: TargetRow[];
  grup: GrupRow[];
  waSiap: boolean;
  /**
   * Tanggal yang sedang ditampilkan tabel "Pasien baru" di atas -- itu pula yang
   * dikirim tombol uji, supaya apa yang dilihat staf adalah apa yang berangkat.
   */
  tanggal: string;
}) {
  const [menambah, setMenambah] = useState(false);
  const [menghapus, setMenghapus] = useState<TargetRow | null>(null);
  /**
   * Uji dikonfirmasi, berbeda dari tombol uji di /farmasi dan /bpjs yang langsung
   * mengirim.
   *
   * Bedanya bukan kehati-hatian melainkan ISINYA: kedua tombol itu mengirim
   * kalimat tetap, yang ini mengirim rekap produksi berikut DAFTAR NAMA PASIEN.
   * Pesan WhatsApp yang sudah sampai tidak bisa ditarik kembali, dan keanggotaan
   * sebuah grup diatur di luar sistem ini -- jadi "cuma uji kok" adalah persis
   * anggapan yang membuat orang menekannya sebelum meninjau siapa saja yang ada
   * di sana.
   */
  const [menguji, setMenguji] = useState<TargetRow | null>(null);
  const [pesan, setPesan] = useState<HasilForm>({});
  const [pending, start] = useTransition();
  const [hasilTambah, aksiTambah] = useActionState(tambahTargetAction, {} as HasilForm);

  function jalankan(fn: () => Promise<HasilForm>) {
    start(async () => setPesan(await fn()));
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          Tujuan <span className="font-medium text-foreground">Nonaktif</span> tidak menerima apa pun,
          apa pun centangnya.{' '}
          <span className="text-foreground">
            <strong>Kirim rekap uji</strong> mengirim rekap {tanggal} yang sungguhan — bukan kalimat
            contoh.
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !waSiap}
            title={waSiap ? undefined : 'WhatsApp belum tersambung'}
            onClick={() => jalankan(syncGrupAction)}
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
          Rekap perlu tahu ke mana harus dikirim. Tambahkan grup keperawatan atau nomor petugasnya.
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
                    Terima rekap
                    <Petunjuk untuk="arti centang terima rekap">
                      Centang ini yang menentukan sebuah tujuan mulai menerima <strong>nama pasien</strong>.
                      Tujuan yang baru ditambahkan selalu belum tercentang.
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
                      Tombol BERSAUDARA dengan label, tidak pernah di dalamnya:
                      apa pun yang diklik di dalam <label> ikut menyalakan
                      kontrolnya, jadi menekan ikon keterangan akan mengubah
                      setelan yang artinya baru saja hendak ditanyakan.
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
                      <Badge variant={t.isActive ? 'success' : 'neutral'}>
                        {t.isActive ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </label>
                  </td>
                  <td className={cellClass}>
                    <input
                      type="checkbox"
                      aria-label={`Terima rekap untuk ${t.label}`}
                      checked={t.terimaPenilaianUmum}
                      disabled={pending}
                      onChange={(e) => {
                        const v = e.currentTarget.checked;
                        start(() => {
                          void toggleTargetAction(t.id, 'penilaian', v);
                        });
                      }}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  </td>
                  <td className={`${cellClass} text-right`}>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="xs"
                        disabled={pending}
                        onClick={() => setMenguji(t)}
                      >
                        Kirim rekap uji
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setMenghapus(t)}>
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

      <Modal open={menambah} onClose={() => setMenambah(false)} title="Tambah tujuan" size="lg">
        <form action={aksiTambah} className="space-y-3">
          <div>
            <label htmlFor="jenis" className="mb-1 block text-label">
              Jenis
            </label>
            <Select id="jenis" name="jenis" fieldSize="md" defaultValue="grup">
              <option value="grup">Grup WhatsApp</option>
              <option value="personal">Nomor petugas</option>
            </Select>
          </div>

          <div>
            <label htmlFor="nilai" className="mb-1 block text-label">
              Alamat
            </label>
            <Input id="nilai" name="nilai" fieldSize="md" placeholder="120363xxxxxxxxxxxx@g.us atau 08xxxxxxxxxx" />
            <p className="mt-1 text-caption text-muted-foreground">
              Kode grup tidak bisa dilihat dari aplikasi WhatsApp. Tekan{' '}
              <strong>Muat daftar grup</strong> lalu salin dari daftar di bawah — tautan undangan
              (chat.whatsapp.com/…) bukan kode grup dan tidak bisa dipakai.
            </p>
          </div>

          <div>
            <label htmlFor="label" className="mb-1 block text-label">
              Label
            </label>
            <Input id="label" name="label" fieldSize="md" placeholder="Grup Perawat Poli" />
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
            Tujuan <strong>{menghapus?.label}</strong> dihapus permanen. Rekap berikutnya tidak lagi
            dikirim ke sana. Pesan yang sudah terlanjur masuk antrean tetap terkirim.
          </>
        }
        pending={pending}
      />

      {/*
        Dialognya menutup SEBELUM aksinya jalan, jadi hasilnya tampil di atas
        tabel seperti tombol lain -- bukan di dalam dialog. Aman di sini justru
        karena urutannya begitu: <dialog> yang terbuka membuat halaman di
        belakangnya inert, sehingga pesan yang dirender di sana ada di layar tapi
        tertutup backdrop (pelajaran /administrasi).
      */}
      <ConfirmDialog
        open={menguji !== null}
        onClose={() => setMenguji(null)}
        onConfirm={() => {
          const t = menguji;
          setMenguji(null);
          if (t) jalankan(() => kirimUjiAction(t.id, tanggal));
        }}
        title="Kirim rekap uji"
        confirmLabel="Kirim sekarang"
        pendingLabel="Mengirim..."
        message={
          <>
            <strong>{menguji?.label}</strong> akan menerima rekap <strong>{tanggal}</strong> — sama
            persis dengan yang berangkat terjadwal, termasuk{' '}
            <strong>nama pasien dan nomor rekam medis</strong>, bukan kalimat contoh. Pesannya
            ditandai <em>[UJI COBA]</em> di baris pertama.
            <br />
            <br />
            Pesan WhatsApp yang sudah terkirim tidak bisa ditarik kembali. Pastikan dulu siapa saja
            yang ada di dalam tujuan ini.
          </>
        }
        pending={pending}
      />
    </>
  );
}
