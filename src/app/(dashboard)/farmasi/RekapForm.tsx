'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { REKAP_PENJUALAN_TEMPLATE_VARIABLES } from '@/core/template';
import {
  simpanRekapPenjualanAction,
  pratinjauRekapPenjualanAction,
  type HasilPenjualan,
  type HasilPratinjauRekap,
} from './penjualanActions';

export interface NilaiRekap {
  jam: string;
  offset: number;
  template: string;
  templateKosong: string;
}

/**
 * Kalimat yang membacakan akibat setelan jam + offset.
 *
 * Ini bagian terpenting halaman ini, bukan hiasan. Sistem TIDAK BISA menyimpulkan
 * hari mana yang dimaksud dari jamnya sendiri: 21:00 jelas memaksudkan hari itu
 * juga, 07:00 jelas memaksudkan kemarin, dan menebaknya berarti mengirim rekap
 * yang isinya nyaris kosong tanpa satu pun galat. Jadi dua setelannya berdiri
 * sendiri -- dan dua setelan yang bisa saling bertentangan wajib dibacakan
 * akibatnya, bukan cuma ditampilkan angkanya.
 *
 * Peringatan pada kombinasi pagi + offset 0 berangkat dari pengukuran: penjualan
 * di apotek ini berlangsung pukul 08:00-20:00 dengan puncaknya pukul 19:00, jadi
 * rekap "hari ini" yang dikirim sebelum siang hampir selalu memuat sebagian kecil
 * hari itu -- benar secara harfiah, dan menyesatkan sebagai laporan.
 */
function Akibat({ jam, offset }: { jam: string; offset: number }) {
  const cocok = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(jam);
  if (!cocok) {
    return (
      <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
        Jam kirim belum berbentuk <span className="font-medium">HH:MM</span> &mdash; mis. <code>21:00</code>.
      </p>
    );
  }
  const j = Number(cocok[1]);
  const m = Number(cocok[2]);
  if (j > 23 || m > 59) {
    return (
      <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
        Jam <span className="font-medium">{jam}</span> tidak ada dalam sehari.
      </p>
    );
  }

  const jamRapi = `${String(j).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
  const hari = offset === 0 ? 'hari itu juga' : offset === 1 ? 'sehari sebelumnya' : `${offset} hari sebelumnya`;
  const pagi = offset === 0 && j < 12;

  return (
    <div className={`mt-2 rounded-md border p-2 text-xs ${pagi ? 'border-warning/40 bg-warning/5' : 'border-border bg-background/50'}`}>
      <p>
        Setiap hari pukul <span className="font-medium">{jamRapi}</span>, sistem mengirim rekap penjualan{' '}
        <span className="font-medium">{hari}</span>.
      </p>
      {pagi && (
        <p className="mt-1 text-muted-foreground">
          Jam sepagi ini dengan &ldquo;hari ini&rdquo; berarti rekapnya memuat penjualan yang{' '}
          <span className="font-medium text-foreground">baru berjalan beberapa jam</span>. Apotek ini berjualan pukul
          08.00&ndash;20.00 dengan puncaknya pukul 19.00 (diukur 90 hari), jadi angkanya akan selalu jauh lebih kecil
          daripada hari penuh. Untuk jam pagi, pilih <span className="font-medium text-foreground">1</span> supaya yang
          direkap adalah hari kemarin yang sudah lengkap.
        </p>
      )}
    </div>
  );
}

export function RekapForm({ nilai, adaTujuan }: { nilai: NilaiRekap; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilPenjualan, fd: FormData) => simpanRekapPenjualanAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauRekap, fd: FormData) => pratinjauRekapPenjualanAction(prev, fd),
    {},
  );

  // Dikendalikan state HANYA supaya kalimat akibatnya ikut berubah saat diketik.
  // Nilainya tetap dibaca server dari FormData, bukan dari state ini.
  const [jam, setJam] = useState(nilai.jam);
  const [offset, setOffset] = useState(nilai.offset);

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima rekap ini.</span> Rekap dikirim ke tujuan yang
          mencentang &ldquo;Penjualan&rdquo; &mdash; daftar yang sama dengan nota per transaksi. Centang di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          .
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Jam kirim</label>
              <Petunjuk untuk="Jam kirim rekap">
                Bawaannya <span className="font-medium text-foreground">21.00</span>, dan itu diukur: sepanjang 90 hari
                terakhir tidak ada satu pun transaksi setelah pukul 20.00, sementara pukul 19.00 justru jam tersibuk.
                Rekap pukul 18.00 akan rutin melewatkan jam paling ramai.
              </Petunjuk>
            </div>
            <Input
              type="time"
              name="penjualan_rekap_jam"
              value={jam}
              onChange={(e) => setJam(e.target.value)}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Hari yang direkap</label>
              <Petunjuk untuk="Hari yang direkap">
                Dihitung mundur dari hari saat rekapnya dikirim.{' '}
                <span className="font-medium text-foreground">0</span> = hari itu juga,{' '}
                <span className="font-medium text-foreground">1</span> = kemarin.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="penjualan_rekap_offset_hari"
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
              min={0}
              max={7}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
        </div>

        <Akibat jam={jam} offset={offset} />

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">Isi pesan rekap</label>
            <Petunjuk untuk="Isi pesan rekap">
              Variabelnya <span className="font-medium text-foreground">berbeda</span> dari isi pesan nota di atas:
              semuanya angka sehari penuh, bukan satu nota. Yang menyebut satu transaksi ({'{no_nota}'},{' '}
              {'{daftar_barang}'}) memang tidak tersedia di sini &mdash; pada agregat sehari, keduanya tidak punya
              arti.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_penjualan_rekap"
            defaultValue={nilai.template}
            variables={REKAP_PENJUALAN_TEMPLATE_VARIABLES}
            rows={12}
            disabled={simpanPending}
            hint="Rincian per jenis penjualan dirakit sistem dan dipasang ke {rincian_jenis} — satu baris per jenis, berisi jumlah nota dan totalnya."
          />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">
              Isi pesan saat tidak ada penjualan sama sekali <span className="text-muted-foreground">(opsional)</span>
            </label>
            {/* Kosong = diam, dan bawaannya memang kosong -- alasan yang sama
                dengan `farmasi.template_darurat_kosong`. Tapi mengisinya punya
                guna yang nyata, dan itu perlu tetap bisa dibaca supaya
                "opsional" tidak terbaca sebagai "tidak berguna". */}
            <Petunjuk untuk="Isi pesan saat tidak ada penjualan">
              Dikosongkan, hari tanpa penjualan lewat tanpa pesan &mdash; pesan harian yang isinya &ldquo;tidak ada
              apa-apa&rdquo; berhenti dibaca dalam seminggu, dan sejak itu yang sungguhan ikut tidak terbaca. Diisi, ia
              jadi tanda hidup: apotek yang biasanya ramai lalu menerima &ldquo;tidak ada penjualan&rdquo; tahu ada
              yang perlu diperiksa.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_penjualan_rekap_kosong"
            defaultValue={nilai.templateKosong}
            variables={REKAP_PENJUALAN_TEMPLATE_VARIABLES}
            rows={5}
            disabled={simpanPending}
            hint="Dibiarkan kosong = sistem DIAM pada hari tanpa penjualan."
          />
        </div>

        {simpan.error && <p className="text-sm text-destructive">{simpan.error}</p>}
        {simpan.sukses && <p className="text-sm text-success">{simpan.sukses}</p>}

        <Button type="submit" disabled={simpanPending}>
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan rekap'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium">
          Lihat rekap hari yang akan dibaca
          <Petunjuk untuk="Pratinjau rekap harian">
            Membaca penjualan lewat jalur yang sama persis dipakai worker, lalu merendernya dengan isi pesan{' '}
            <span className="font-medium text-foreground">yang sudah tersimpan</span> &mdash; bukan yang sedang diketik
            di atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
          </Petunjuk>
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}

        {/* Hari tanpa penjualan + pesan kosong yang sengaja diam. Dikatakan
            eksplisit: pratinjau yang tidak menampilkan apa pun terbaca sebagai
            fitur rusak, padahal itu justru perilaku yang diminta. */}
        {pratinjau.diam && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada penjualan pada <span className="font-medium text-foreground">{pratinjau.tanggal}</span>, dan isi
            pesan saat kosong dibiarkan kosong &mdash; jadi pada hari seperti ini sistem sengaja tidak mengirim apa pun.
          </p>
        )}

        {pratinjau.teks && (
          <div className="mt-3">
            {/* Tanggalnya WAJIB disebut. Rekap yang isinya mengejutkan (nyaris
                kosong pada pagi hari karena offsetnya 0) tidak bisa dibedakan
                dari query yang salah tanpa tahu hari mana yang dibaca. */}
            <p className="mb-1 text-xs text-muted-foreground">
              Penjualan tanggal <span className="font-medium text-foreground">{pratinjau.tanggal}</span> &mdash;{' '}
              {pratinjau.jumlahNota} nota.
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
              {pratinjau.teks}
            </pre>
          </div>
        )}
      </form>
    </div>
  );
}
