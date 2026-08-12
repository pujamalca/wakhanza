'use client';

import { useState, useTransition } from 'react';
import { Button, ConfirmDialog } from '@/components/ui';
import { hapusPenerimaJadwalAction } from '../actions';

/**
 * Tombol "Keluarkan" per baris penerima di halaman detail jadwal.
 *
 * Pakai ConfirmDialog, bukan form server-action telanjang seperti tombol
 * Jeda/Hapus di tabel daftar, dan alasannya bukan keseragaman melainkan
 * KETERBALIKAN: pada jadwal berfilter, tindakan ini mengubah bentuk jadwalnya
 * jadi daftar tetap -- dan itu TIDAK bisa dikembalikan lewat tombol mana pun.
 * Staf harus tahu itu sebelum menekan, bukan sesudah.
 *
 * Yang dikirim ke server cuma satu no. RM. Daftar acuannya dibaca ulang di
 * sana lewat pintu yang sama dipakai worker -- lihat hapusPenerimaJadwalAction.
 */
export function HapusPenerima({
  scheduleId,
  noRkmMedis,
  nama,
  /** True bila jadwalnya masih berfilter, jadi tindakan ini akan mengonversinya. */
  konversi,
}: {
  scheduleId: number;
  noRkmMedis: string;
  nama: string | null;
  konversi: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const label = nama?.trim() || `no. RM ${noRkmMedis}`;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          setGalat(null);
          setBuka(true);
        }}
        // Tanpa nama pasiennya, pembaca layar cuma mendengar "Keluarkan,
        // Keluarkan, Keluarkan" pada tabel yang tiap barisnya seorang pasien.
        aria-label={`Keluarkan ${label} dari jadwal ini`}
      >
        Keluarkan
      </Button>

      <ConfirmDialog
        open={buka}
        onClose={() => setBuka(false)}
        pending={pending}
        confirmLabel="Keluarkan"
        pendingLabel="Mengeluarkan..."
        title={`Keluarkan ${label}?`}
        message={
          <div className="space-y-2">
            <p>
              Pasien ini tidak akan dikirimi lagi oleh jadwal tersebut. Pesan yang sudah <em>terlanjur</em> masuk antrean
              tidak ikut dibatalkan &mdash; periksa halaman Antrean bila jadwalnya baru saja jalan.
            </p>
            {konversi && (
              <p className="rounded-md border border-warning/30 bg-warning/5 p-2">
                Jadwal ini sekarang memakai <strong>filter</strong>, jadi mengeluarkan seseorang akan mengubahnya menjadi{' '}
                <strong>daftar tetap</strong> berisi pasien yang tersisa. Sesudah itu ia berhenti menjaring pasien baru yang
                cocok dengan filter yang sama, dan itu <strong>tidak bisa dikembalikan</strong> lewat tombol &mdash; jadwalnya
                harus disusun ulang.
              </p>
            )}
            {/* Galat WAJIB tampil di dalam dialog: selama <dialog> terbuka,
                seluruh halaman di belakangnya inert, jadi pesan yang dirender
                di baris tabel ada di layar tapi tertutup backdrop -- dan yang
                terlihat cuma tombol yang tidak melakukan apa-apa. Pelajaran
                yang sama sudah dibayar di modal pratinjau surat. */}
            {galat && (
              <p role="alert" className="text-destructive">
                {galat}
              </p>
            )}
          </div>
        }
        onConfirm={() => {
          startTransition(async () => {
            const hasil = await hapusPenerimaJadwalAction(scheduleId, noRkmMedis);
            if (hasil.error) {
              // Dialog TETAP terbuka saat gagal: menutupnya lalu menampilkan
              // galat di baris tabel berarti pesannya muncul di halaman yang
              // baru saja bergeser, dan yang terlihat cuma tombol yang tidak
              // melakukan apa-apa.
              setGalat(hasil.error);
              return;
            }
            setBuka(false);
          });
        }}
      />
    </>
  );
}
