'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  EmptyState,
  Badge,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
  IconFileText,
} from '@/components/ui';
import { kirimSuratAction, type HasilForm } from './actions';
import { PratinjauSurat } from './PratinjauSurat';
// Tipe diimpor dari modul MURNI, bukan dari berkas 'use server' -- lihat
// komentar `JenisSurat` di core/suratDoc.ts.
import type { JenisSurat } from '@/core/suratDoc';

export interface BarisSurat {
  /** `no_surat` untuk surat sakit, `no_rawat` untuk surat sehat. */
  kunci: string;
  namaPasien: string;
  noRm: string;
  tanggal: string;
  /** Baris keterangan kedua: lama istirahat, atau nama poli. */
  keterangan: string;
  /** Kosong = nomornya tidak terpakai; isinya alasan singkat untuk ditampilkan. */
  masalahNomor: string;
  poliSensitif: boolean;
}

/**
 * Kenapa sebuah baris tidak boleh dikirim -- SATU penurunan, bukan dua.
 *
 * Sebelumnya syarat terkuncinya dihitung di satu tempat (`terkunci`) dan
 * alasannya dirangkai lagi di tempat lain (`title` tombol), dengan urutan
 * cabang yang berbeda pula. Selama keduanya kebetulan sepakat tidak ada yang
 * terlihat; begitu menyimpang, yang muncul adalah tombol yang mati tanpa
 * keterangan atau keterangan yang menyebut sebab yang salah. Bentuk kegagalan
 * yang sama sudah dibayar di `respectsOptOut()` dan `core/outboxStatus.ts` --
 * dan sekarang penurunannya dipakai DUA layar (baris tabel dan modal
 * pratinjau), jadi menyalinnya berarti tiga tempat yang harus sepakat.
 *
 * `undefined` = boleh dikirim.
 */
function alasanTerkunci(r: BarisSurat, aktif: boolean): string | undefined {
  if (!aktif) return 'Pengiriman dokumen masih dimatikan di tab Pengaturan';
  if (r.poliSensitif) return 'Poli sensitif -- dokumen diserahkan langsung di loket';
  if (r.masalahNomor) return 'Nomor WhatsApp pasien belum bisa dipakai';
  return undefined;
}

/**
 * Daftar surat + tombol Lihat dan Kirim.
 *
 * TIDAK memakai modal konfirmasi untuk Kirim, dan itu keputusan yang berbeda
 * dari tombol Hapus di halaman lain: yang berbahaya pada penghapusan adalah
 * tidak bisa ditarik kembali, sementara di sini tindakan yang salah paling
 * jauh berarti satu pasien menerima suratnya sendiri dua kali. Yang justru
 * menjaga di sini adalah PRATINJAU -- staf melihat berkasnya lebih dulu, dan
 * dialog konfirmasi yang muncul setelah orang sudah membaca isinya cuma satu
 * ketukan tambahan yang lama-lama ditekan tanpa dibaca.
 *
 * Justru karena pratinjau yang menjaga, tombol Kirim ADA JUGA di dalam
 * modalnya: menutup pratinjau untuk mencari kembali barisnya di tabel adalah
 * jarak yang mengundang orang melewati pratinjaunya sama sekali.
 */
export function SuratTable({
  jenis,
  rows,
  aktif,
}: {
  jenis: JenisSurat;
  rows: BarisSurat[];
  aktif: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Kunci baris yang sedang dikirim -- supaya hanya tombolnya sendiri yang
  // berubah jadi "Mengirim...", bukan seluruh tombol di tabel.
  const [sedang, setSedang] = useState<string | null>(null);
  const [hasil, setHasil] = useState<(HasilForm & { kunci: string }) | null>(null);
  // Baris yang sedang dipratinjau. Satu state untuk seluruh tabel -- lihat
  // catatan "SATU modal untuk seluruh tabel" di PratinjauSurat.tsx.
  const [pratinjau, setPratinjau] = useState<BarisSurat | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconFileText className="h-6 w-6" />}
        title={jenis === 'sakit' ? 'Belum ada surat keterangan sakit' : 'Belum ada kunjungan'}
      >
        {jenis === 'sakit'
          ? 'Tidak ada surat sakit yang dibuat pada rentang tanggal ini. Suratnya dibuat lewat SIMRS Khanza; di sini hanya dikirimkan.'
          : 'Tidak ada kunjungan pada rentang tanggal ini.'}
      </EmptyState>
    );
  }

  function kirim(kunci: string) {
    setSedang(kunci);
    setHasil(null);
    startTransition(async () => {
      const r = await kirimSuratAction(jenis, kunci);
      setHasil({ ...r, kunci });
      setSedang(null);
      // Berhasil: pratinjaunya sudah selesai tugasnya, dan hasilnya muncul di
      // barisnya sendiri. GAGAL sengaja membiarkan modal terbuka -- pesannya
      // ikut ditampilkan di sana, dan menutupnya berarti staf kehilangan
      // konteks tentang surat mana yang barusan gagal.
      if (r.sukses) setPratinjau(null);
    });
  }

  const alasanPratinjau = pratinjau ? alasanTerkunci(pratinjau, aktif) : undefined;

  return (
    <>
      <div className={tableWrapperClass}>
        <table className="w-full text-sm">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Pasien</th>
              <th className={`${cellClass} hidden sm:table-cell`}>Tanggal</th>
              <th className={`${cellClass} hidden md:table-cell`}>Keterangan</th>
              <th className={cellClass}>Nomor</th>
              <th className={`${cellClass} text-right`}>Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const alasan = alasanTerkunci(r, aktif);
              return (
                <tr key={r.kunci} className={rowClass}>
                  <td className={cellClass}>
                    <div className="font-medium">{r.namaPasien}</div>
                    <div className="text-xs text-muted-foreground">
                      RM {r.noRm} · <span className="font-mono">{r.kunci}</span>
                    </div>
                    {/* Keterangan yang di layar sempit kolomnya disembunyikan
                        tetap harus terbaca -- kalau tidak, staf memutuskan kirim
                        tanpa melihat lama istirahat atau polinya. */}
                    <div className="mt-1 text-xs text-muted-foreground sm:hidden">
                      {r.tanggal} · {r.keterangan}
                    </div>
                  </td>
                  <td className={`${cellClass} hidden whitespace-nowrap sm:table-cell`}>{r.tanggal}</td>
                  <td className={`${cellClass} hidden md:table-cell`}>{r.keterangan}</td>
                  <td className={cellClass}>
                    {r.masalahNomor ? (
                      <Badge variant="warning" title="Pesan tidak akan sampai selama nomornya belum diperbaiki">
                        {r.masalahNomor}
                      </Badge>
                    ) : (
                      <Badge variant="success">Terpakai</Badge>
                    )}
                    {r.poliSensitif && (
                      <div className="mt-1">
                        <Badge variant="warning" title="Poli ditandai sensitif di Pengaturan">
                          Poli sensitif
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className={`${cellClass} text-right whitespace-nowrap`}>
                    <div className="inline-flex gap-2">
                      {/* Tombol, bukan tautan: sejak pratinjaunya muncul sebagai
                          modal di halaman ini, menekannya bukan navigasi. */}
                      <Button size="xs" onClick={() => setPratinjau(r)}>
                        Lihat
                      </Button>
                      <Button
                        size="xs"
                        onClick={() => kirim(r.kunci)}
                        disabled={!!alasan || pending}
                        title={alasan}
                      >
                        {sedang === r.kunci ? 'Mengirim...' : 'Kirim'}
                      </Button>
                    </div>
                    {hasil?.kunci === r.kunci && (hasil.error || hasil.sukses) && (
                      <p
                        className={`mt-1 max-w-xs text-left text-xs ${hasil.error ? 'text-destructive' : 'text-success'}`}
                      >
                        {hasil.error ?? hasil.sukses}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PratinjauSurat
        jenis={jenis}
        sasaran={pratinjau}
        onClose={() => setPratinjau(null)}
        onKirim={() => pratinjau && kirim(pratinjau.kunci)}
        terkunci={!!alasanPratinjau}
        alasanTerkunci={alasanPratinjau}
        sedangKirim={sedang === pratinjau?.kunci}
        galat={hasil?.kunci === pratinjau?.kunci ? hasil?.error : undefined}
      />
    </>
  );
}
