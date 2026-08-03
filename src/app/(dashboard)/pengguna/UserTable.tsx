'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  Input,
  Select,
  Button,
  Badge,
  Modal,
  ConfirmDialog,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { PERAN_LABEL, PERAN_KETERANGAN, PANJANG_SANDI_MINIMAL, type AppUserRole } from '@/core/userPolicy';
import {
  buatPenggunaAction,
  ubahPenggunaAction,
  setelSandiAction,
  setelAktifAction,
  bukaKunciAction,
  type HasilForm,
} from './actions';

export interface UserRow {
  id: number;
  username: string;
  name: string;
  role: AppUserRole;
  isActive: boolean;
  terkunci: boolean;
  createdAt: string;
}

/**
 * Tabel, bukan kartu -- pertanyaan yang dibawa admin ke halaman ini selalu
 * berbentuk perbandingan ("siapa saja yang masih bisa masuk", "siapa yang
 * admin"), dan itu hanya terjawab kalau semuanya terlihat sekaligus dalam satu
 * layar. Penyuntingan lewat modal, sesuai pola /template dan /balasan-otomatis.
 */
export function UserTable({ users, usernameSaya }: { users: UserRow[]; usernameSaya: string }) {
  const [membuat, setMembuat] = useState(false);
  const [mengubah, setMengubah] = useState<UserRow | null>(null);
  const [menyetelSandi, setMenyetelSandi] = useState<UserRow | null>(null);
  const [menonaktifkan, setMenonaktifkan] = useState<UserRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm>({});

  function jalankan(fn: () => Promise<HasilForm>) {
    startTransition(async () => setPesan(await fn()));
  }

  const setSukses = (sukses: string) => setPesan({ sukses });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Akun dinonaktifkan, bukan dihapus &mdash; jejak audit menyimpan nama penggunanya, dan menghapus akun membuat
          riwayat lama menunjuk orang yang tidak ada lagi.
        </p>
        <Button variant="primary" size="sm" onClick={() => setMembuat(true)} className="shrink-0">
          Tambah pengguna
        </Button>
      </div>

      {pesan.error && <p className="mb-3 text-xs text-destructive">{pesan.error}</p>}
      {pesan.sukses && <p className="mb-3 text-xs text-success">{pesan.sukses}</p>}

      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Nama pengguna</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Nama lengkap</th>
              <th className={cellClass}>Peran</th>
              <th className={cellClass}>Status</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Dibuat</th>
              <th className={`${cellClass} w-px`}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const saya = u.username === usernameSaya;
              return (
                <tr key={u.id} className={rowClass}>
                  <td className={`${cellClass} whitespace-nowrap font-mono text-xs`}>
                    {u.username}
                    {saya && <span className="ml-1.5 font-sans text-xs text-muted-foreground">(Anda)</span>}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap sm:table-cell`}>{u.name}</td>
                  <td className={cellClass}>
                    <Badge variant={u.role === 'admin' ? 'success' : 'neutral'}>{PERAN_LABEL[u.role]}</Badge>
                  </td>
                  <td className={cellClass}>
                    {!u.isActive ? (
                      <Badge variant="neutral">Nonaktif</Badge>
                    ) : u.terkunci ? (
                      <Badge variant="warning">Terkunci</Badge>
                    ) : (
                      <Badge variant="success">Aktif</Badge>
                    )}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell`}>
                    {u.createdAt}
                  </td>
                  <td className={cellClass}>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => setMengubah(u)} disabled={pending}>
                        Ubah
                      </Button>
                      <Button variant="secondary" size="xs" onClick={() => setMenyetelSandi(u)} disabled={pending}>
                        Setel sandi
                      </Button>
                      {u.terkunci && (
                        <Button variant="secondary" size="xs" disabled={pending} onClick={() => jalankan(() => bukaKunciAction(u.id))}>
                          Buka kunci
                        </Button>
                      )}
                      {u.isActive ? (
                        <Button variant="destructive" size="xs" onClick={() => setMenonaktifkan(u)} disabled={pending || saya}>
                          Nonaktifkan
                        </Button>
                      ) : (
                        <Button variant="secondary" size="xs" disabled={pending} onClick={() => jalankan(() => setelAktifAction(u.id, true))}>
                          Aktifkan
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pesan sukses dinaikkan ke halaman, bukan ditampilkan di dalam modal
          yang justru langsung menutup. Untuk "Ubah" dan "Tambah" hasilnya masih
          terlihat di tabel, tapi SETEL SANDI tidak mengubah apa pun yang
          tampak: tanpa kalimat ini, modal yang menutup diam-diam terbaca sama
          persis seperti modal yang gagal tanpa pesan. */}
      {membuat && <UserModal user={null} onClose={() => setMembuat(false)} onSukses={setSukses} />}
      {mengubah && <UserModal key={mengubah.id} user={mengubah} onClose={() => setMengubah(null)} onSukses={setSukses} />}
      {menyetelSandi && (
        <SandiModal key={menyetelSandi.id} user={menyetelSandi} onClose={() => setMenyetelSandi(null)} onSukses={setSukses} />
      )}

      <ConfirmDialog
        open={menonaktifkan !== null}
        onClose={() => setMenonaktifkan(null)}
        pending={pending}
        title={`Nonaktifkan "${menonaktifkan?.username ?? ''}"?`}
        message={
          <>
            Akun ini tidak akan bisa <span className="font-medium text-foreground">login lagi</span>. Riwayat auditnya tetap
            utuh, dan akun bisa diaktifkan kembali kapan saja.
            <br />
            <br />
            {/* Batas ini nyata dan harus diketahui SEBELUM dibutuhkan, bukan
                ditemukan saat sedang buru-buru memutus akses seseorang. */}
            <span className="font-medium text-foreground">Sesi yang sedang berjalan tidak ikut terputus.</span> Kalau
            orangnya sedang membuka dashboard, ia tetap bisa memakainya sampai sesinya kedaluwarsa (paling lama 8 jam).
          </>
        }
        onConfirm={() => {
          const id = menonaktifkan?.id;
          if (id === undefined) return;
          startTransition(async () => {
            setPesan(await setelAktifAction(id, false));
            setMenonaktifkan(null);
          });
        }}
      />
    </>
  );
}

function UserModal({
  user,
  onClose,
  onSukses,
}: {
  user: UserRow | null;
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const [peran, setPeran] = useState<AppUserRole>(user?.role ?? 'operator');
  const [state, formAction, isPending] = useActionState(
    async (prev: HasilForm, formData: FormData) => {
      const hasil = user ? await ubahPenggunaAction(user.id, formData) : await buatPenggunaAction(prev, formData);
      // Ditutup HANYA bila benar-benar tersimpan -- menutup saat gagal validasi
      // membuang yang sudah diketik tanpa memberi tahu kenapa.
      if (!hasil.error) {
        if (hasil.sukses) onSukses(hasil.sukses);
        onClose();
      }
      return hasil;
    },
    {} as HasilForm,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Ubah pengguna: ${user.username}` : 'Pengguna baru'}
      description={
        user
          ? 'Nama pengguna tidak bisa diubah — ia dipakai sebagai penanda di jejak audit.'
          : 'Nama pengguna dipakai untuk login dan sebagai penanda di jejak audit, jadi tidak bisa diubah lagi setelah dibuat.'
      }
    >
      <form action={formAction} className="space-y-3">
        {!user && (
          <label className="block space-y-1">
            <span className="block text-xs font-medium">Nama pengguna</span>
            <Input name="username" placeholder="mis. loket1 atau budi.santoso" className="w-full" fieldSize="sm" autoFocus required />
            <span className="block text-xs text-muted-foreground">
              Huruf kecil, angka, titik, garis bawah, strip. Tanpa spasi.
            </span>
          </label>
        )}

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Nama lengkap</span>
          <Input
            name="name"
            defaultValue={user?.name}
            placeholder="mis. Budi Santoso"
            className="w-full"
            fieldSize="sm"
            autoFocus={!!user}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-xs font-medium">Peran</span>
          <Select
            name="role"
            value={peran}
            onChange={(e) => setPeran(e.target.value as AppUserRole)}
            fieldSize="sm"
            className="w-full"
          >
            <option value="operator">{PERAN_LABEL.operator}</option>
            <option value="admin">{PERAN_LABEL.admin}</option>
          </Select>
          {/* Keterangan mengikuti pilihan, bukan mendaftar keduanya sekaligus:
              yang perlu dijawab adalah "apa akibat pilihan SAYA", dan dua
              paragraf berdampingan justru membuat itu harus dicari dulu. */}
          <span className="block text-xs text-muted-foreground">{PERAN_KETERANGAN[peran]}</span>
        </label>

        {!user && (
          <label className="block space-y-1">
            <span className="block text-xs font-medium">Kata sandi awal</span>
            <Input name="password" type="password" autoComplete="new-password" className="w-full" fieldSize="sm" required />
            <span className="block text-xs text-muted-foreground">
              Minimal {PANJANG_SANDI_MINIMAL} karakter. Sampaikan langsung ke orangnya dan minta ia menggantinya sendiri
              lewat halaman Profil.
            </span>
          </label>
        )}

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan...' : user ? 'Simpan perubahan' : 'Tambah pengguna'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SandiModal({
  user,
  onClose,
  onSukses,
}: {
  user: UserRow;
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(
    async (_prev: HasilForm, formData: FormData) => {
      const hasil = await setelSandiAction(user.id, formData);
      if (!hasil.error) {
        onSukses(hasil.sukses ? `${hasil.sukses} Sampaikan kata sandi baru itu ke ${user.username}.` : 'Tersimpan.');
        onClose();
      }
      return hasil;
    },
    {} as HasilForm,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Setel ulang kata sandi: ${user.username}`}
      description="Dipakai saat pengguna lupa kata sandinya. Kunci login yang sedang berlaku ikut dilepas."
    >
      <form action={formAction} className="space-y-3">
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Kata sandi baru</span>
          <Input name="password" type="password" autoComplete="new-password" className="w-full" fieldSize="sm" autoFocus required />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium">Ulangi kata sandi baru</span>
          <Input name="passwordUlangi" type="password" autoComplete="new-password" className="w-full" fieldSize="sm" required />
        </label>

        <p className="text-xs text-muted-foreground">
          Anda tidak diminta kata sandi lama karena memang tidak mengetahuinya. Yang menjaga di sini adalah peran admin
          dan jejak audit &mdash; tindakan ini tercatat atas nama Anda.
        </p>

        {state.error && <p className="text-xs text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan...' : 'Setel ulang'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
