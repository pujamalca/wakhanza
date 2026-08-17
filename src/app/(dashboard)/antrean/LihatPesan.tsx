'use client';

import { useState } from 'react';
import { Button, CopyButton, Modal } from '@/components/ui';

/**
 * Isi pesan yang UTUH, dan kenapa itu perlu tempatnya sendiri.
 *
 * Sel "Isi" di tabel dulu dipotong `truncate` pada `max-w-xs` dan selebihnya
 * dititipkan ke atribut `title`. Diukur atas 885 baris produksi, KEDUANYA
 * tidak menampilkan apa pun yang berguna:
 *
 * - 884 dari 885 baris lebih panjang daripada yang muat (rata-rata 258 huruf,
 *   terpanjang 9.485 -- rekap darurat stok berisi 208 barang).
 * - 883 dari 885 BERBARIS BANYAK, sementara `truncate` justru meratakannya jadi
 *   satu baris. Jadi yang hilang bukan cuma ekornya melainkan susunan pesan
 *   yang benar-benar diterima pasien.
 *
 * Tooltip bawaan peramban bukan penggantinya, dan tiga sebabnya berdiri
 * sendiri-sendiri: ia tidak pernah muncul di layar sentuh (tablet loket), ia
 * hilang begitu halaman digulir, dan isinya tidak bisa diseleksi -- padahal
 * yang paling sering dibutuhkan petugas saat menjawab telepon justru MENYALIN
 * kalimatnya untuk dibacakan atau dikirim ulang lewat jalur lain.
 *
 * Kolom "Isi" sendiri juga `hidden lg:table-cell`, jadi di bawah 1024 px isi
 * pesan tidak terlihat SAMA SEKALI. Tombol ini karena itu tidak ikut
 * disembunyikan: di layar sempit ia satu-satunya jalan menuju isi pesannya.
 */
export interface RincianPesan {
  jenis: string;
  kodePemicu: string;
  noRkmMedis: string | null;
  tujuan: string | null;
  /** Grup/petugas (`chat_id`), bukan nomor seorang pasien. */
  tujuanGrup: boolean;
  status: string;
  ack: string | null;
  kejadian: string;
  dijadwalkan: string;
  /** `scheduled_at` berbeda dari `event_at` -- pesannya dimundurkan. */
  dimundurkan: boolean;
  terkirim: string | null;
  percobaan: number;
  lampiran: string | null;
  galat: string | null;
  isi: string;
}

export function LihatPesan({ rincian }: { rincian: RincianPesan }) {
  const [buka, setBuka] = useState(false);

  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => setBuka(true)}>
        Lihat
      </Button>
      {/* Dipasang HANYA saat dibuka, mengikuti pola RuleModal di
          /balasan-otomatis: satu halaman memuat 50 baris, dan satu <dialog>
          per baris berarti lima puluh dialog menganggur di DOM. */}
      {buka && <ModalPesan rincian={rincian} onClose={() => setBuka(false)} />}
    </>
  );
}

function ModalPesan({ rincian, onClose }: { rincian: RincianPesan; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={rincian.jenis}
      description={`Isi pesan apa adanya, persis seperti yang dikirim ke ${
        rincian.tujuanGrup ? 'tujuan ini' : 'nomor pasien'
      }.`}
    >
      <div className="space-y-4">
        {/* Sebab kegagalan sebelumnya TIDAK ADA di halaman ini sama sekali --
            statusnya terbaca "Gagal permanen" tanpa satu pun tempat yang
            menyebutkan kenapa. Ditaruh paling atas karena pada baris yang gagal
            ia satu-satunya yang benar-benar dicari orang. */}
        {rincian.galat && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-label font-medium text-destructive">Kenapa gagal</p>
            <p className="mt-1 break-words font-mono text-caption text-foreground">{rincian.galat}</p>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-label font-medium">Isi pesan</span>
            <span className="text-caption text-muted-foreground">{rincian.isi.length} huruf</span>
            <CopyButton value={rincian.isi} label="isi pesan" />
          </div>
          {/* Ditampilkan APA ADANYA, bukan lewat <WaPreview>. Godaannya nyata --
              perender itu ada dan menampilkan *tebal* sebagaimana dilihat
              pasien -- tapi ia juga menandai `{variabel}` sebagai "diganti saat
              dikirim". Pada baris outbox variabelnya SUDAH diganti, jadi
              keterangan itu berbohong tentang pesan yang sudah terlanjur
              terkirim. Teks mentah juga persis yang dicari kotak pencarian di
              atas (`body LIKE`), sehingga yang terbaca staf sama dengan yang
              bisa dicarinya kembali. */}
          <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-body">
            {rincian.isi}
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Fakta label="Jenis pesan" nilai={rincian.jenis} catatan={rincian.kodePemicu} />
          <Fakta label={rincian.tujuanGrup ? 'Tujuan (grup/petugas)' : 'Nomor tujuan'} nilai={rincian.tujuan} mono />
          <Fakta label="No. RM" nilai={rincian.noRkmMedis} mono />
          <Fakta label="Status" nilai={rincian.status} catatan={rincian.ack ?? undefined} />
          <Fakta label="Waktu kejadian" nilai={rincian.kejadian} />
          <Fakta
            label="Dijadwalkan"
            nilai={rincian.dijadwalkan}
            catatan={rincian.dimundurkan ? 'dimundurkan dari waktu kejadian' : undefined}
          />
          <Fakta label="Terkirim" nilai={rincian.terkirim} />
          <Fakta label="Percobaan kirim" nilai={String(rincian.percobaan)} />
          {rincian.lampiran && <Fakta label="Lampiran" nilai={rincian.lampiran} />}
        </dl>
      </div>
    </Modal>
  );
}

function Fakta({
  label,
  nilai,
  catatan,
  mono,
}: {
  label: string;
  nilai: string | null;
  catatan?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={`break-words text-body ${mono ? 'font-mono' : ''}`}>
        {nilai ?? <span className="text-muted-foreground">&mdash;</span>}
        {catatan && <span className="ml-1 text-caption font-normal text-muted-foreground">({catatan})</span>}
      </dd>
    </div>
  );
}
