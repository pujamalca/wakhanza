'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  CopyButton,
  EmptyState,
  IconUsers,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import { muatDaftarGrupAction, type HasilAksi } from './actions';

export interface GrupRow {
  chatId: string;
  nama: string;
  jumlahPeserta: number | null;
  syncedAt: string;
  /** Berapa pesan masuk dari grup ini dalam rentang yang ditampilkan halaman. */
  pesan: number;
}

/**
 * `paginasi` diserahkan dari Server Component induk supaya kendalinya berada DI
 * DALAM `<section>` ini -- kalau dirender sesudahnya, jarak `mb-8` milik section
 * memisahkannya dari tabel yang ia kendalikan.
 */
export function GrupPanel({
  grup,
  waSiap,
  paginasi,
}: {
  grup: GrupRow[];
  waSiap: boolean;
  paginasi?: React.ReactNode;
}) {
  const [hasil, setHasil] = useState<HasilAksi>({});
  const [pending, start] = useTransition();

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Grup yang diikuti nomor rumah sakit</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kode grup di sini yang dipakai di halaman <span className="font-medium">Farmasi</span>. Ia tidak bisa dilihat
            dari aplikasi WhatsApp — tautan undangan (chat.whatsapp.com/…) bukan kode grup.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !waSiap}
          title={waSiap ? undefined : 'WhatsApp belum tersambung'}
          onClick={() => start(async () => setHasil(await muatDaftarGrupAction()))}
        >
          {pending ? 'Meminta...' : 'Muat daftar grup'}
        </Button>
      </div>

      {hasil.error && <p className="mb-3 text-sm text-destructive">{hasil.error}</p>}
      {hasil.sukses && <p className="mb-3 text-sm text-success">{hasil.sukses}</p>}

      {grup.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-6 w-6" />} title="Daftar grup belum pernah dimuat">
          Tekan &ldquo;Muat daftar grup&rdquo; di atas, tunggu beberapa detik, lalu muat ulang halaman. Nomor WhatsApp
          rumah sakit harus sudah menjadi anggota grupnya.
          <span className="mt-2 block">
            Kalau tetap kosong padahal WhatsApp tersambung: <span className="font-medium">tunggu beberapa menit</span>.
            Status &ldquo;tersambung&rdquo; muncul lebih dulu daripada selesainya WhatsApp menyalin riwayat percakapan
            ke komputer ini, dan grup baru bisa terbaca setelah itu — terutama sesudah sesi baru ditautkan ulang.
          </span>
        </EmptyState>
      ) : (
        <div className={tableWrapperClass}>
          <table className="w-full text-sm">
            <thead className={theadClass}>
              <tr>
                <th className={`${cellClass} whitespace-nowrap`}>Nama grup</th>
                <th className={cellClass}>ID grup</th>
                <th className={`${cellClass} hidden sm:table-cell`}>Anggota</th>
                <th className={`${cellClass} hidden lg:table-cell`}>Pesan masuk</th>
                <th className={`${cellClass} hidden md:table-cell`}>Dimuat</th>
              </tr>
            </thead>
            <tbody>
              {grup.map((g) => (
                <tr key={g.chatId} className={rowClass}>
                  <td className={`${cellClass} font-medium`}>{g.nama}</td>
                  <td className={cellClass}>
                    <div className="flex items-center gap-1">
                      {/* break-all: ID grup 24 karakter tanpa spasi akan
                          memaksa tabel melebar jauh di layar sempit. */}
                      <span className="break-all font-mono text-xs text-muted-foreground">{g.chatId}</span>
                      <CopyButton value={g.chatId} label="ID grup" />
                    </div>
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap tabular-nums sm:table-cell`}>
                    {g.jumlahPeserta === null ? '—' : g.jumlahPeserta.toLocaleString('id-ID')}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap tabular-nums lg:table-cell`}>
                    {g.pesan > 0 ? g.pesan.toLocaleString('id-ID') : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell`}>
                    {g.syncedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paginasi}
    </section>
  );
}
