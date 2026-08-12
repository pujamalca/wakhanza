'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { PENJUALAN_TEMPLATE_VARIABLES } from '@/core/template';
import {
  simpanPenjualanAction,
  pratinjauPenjualanAction,
  type HasilPenjualan,
  type HasilPratinjauPenjualan,
} from './penjualanActions';

export interface NilaiPenjualan {
  template: string;
  templateHapus: string;
  harga: boolean;
  kabarHapus: boolean;
  lookback: number;
  kuota: number;
}

export function PenjualanForm({ nilai, adaTujuan }: { nilai: NilaiPenjualan; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilPenjualan, fd: FormData) => simpanPenjualanAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauPenjualan, fd: FormData) => pratinjauPenjualanAction(prev, fd),
    {},
  );

  /**
   * Sakelar kabar-hapus dikendalikan state supaya kotak isi pesannya bisa
   * meredup saat dimatikan. Bukan `disabled`: kotak yang `disabled` tidak ikut
   * terkirim, sehingga mematikan kabar lalu menekan Simpan akan MENGHAPUS isi
   * pesan pembatalan yang sudah disusun staf -- dan itu baru ketahuan berbulan-
   * bulan kemudian saat ada nota yang benar-benar dibatalkan. Pelajaran yang
   * sama dengan kotak cari di mode centang (`readOnly`, bukan `disabled`).
   */
  const [kabarHapus, setKabarHapus] = useState(nilai.kabarHapus);

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima nota ini.</span> Centang
          &ldquo;Penjualan&rdquo; pada salah satu baris di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          . Selama belum dicentang, nota yang disimpan tidak dikirim ke mana pun.
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium">Isi pesan &mdash; nota disimpan</label>
          <MessageEditor
            name="template_penjualan"
            defaultValue={nilai.template}
            variables={PENJUALAN_TEMPLATE_VARIABLES}
            rows={10}
            disabled={simpanPending}
            hint="Daftar barangnya dirakit sistem dan dipasang ke {daftar_barang} — nama barang, jumlah, satuan, dan (bila dinyalakan) harga jualnya."
          />
        </div>

        {/* Sakelar harga MENYALA secara bawaan. Alasannya ditulis di sini, bukan
            cuma di migrasi: yang diminta adalah nota penjualan, dan nota tanpa
            harga bukan nota. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-3">
          <input
            type="checkbox"
            name="penjualan_harga"
            defaultChecked={nilai.harga}
            disabled={simpanPending}
            className="mt-0.5"
          />
          <span className="text-xs">
            <span className="font-medium">Sertakan harga jual di daftar barang</span>
            <span className="mt-1 block text-muted-foreground">
              Saat dimatikan, harga tidak sekadar disembunyikan — kolomnya tidak dibaca sama sekali dari Khanza. Angka
              subtotal dan total tetap ikut, karena itulah yang dicocokkan dengan setoran kasir.
            </span>
          </span>
        </label>

        {/* --------------------------------------------------------------- */}
        {/* Kabar pembatalan                                                */}
        {/* --------------------------------------------------------------- */}
        <div className="rounded-lg border border-border/60 p-3">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              name="penjualan_hapus_kabar"
              checked={kabarHapus}
              onChange={(e) => setKabarHapus(e.target.checked)}
              disabled={simpanPending}
              className="mt-0.5"
            />
            <span className="text-xs">
              <span className="font-medium">Kabari juga saat nota DIHAPUS</span>
              <span className="mt-1 block text-muted-foreground">
                Nota yang dihapus di Khanza tidak meninggalkan jejak apa pun untuk dibaca, jadi sistem menyimpan sendiri
                daftar nomor yang sudah dikabarkan lalu membandingkannya tiap siklus. Tanpa ini, penerima menyimpan nota
                yang sudah dibatalkan sebagai kalau-kalau masih sah — dan justru pembatalan itulah yang paling perlu
                terlihat.
              </span>
            </span>
          </label>

          <div className={`mt-3 ${kabarHapus ? '' : 'opacity-50'}`}>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Isi pesan &mdash; nota dibatalkan</label>
              <Petunjuk untuk="Isi pesan nota dibatalkan">
                Sengaja tanpa isi nota. Satu-satunya sumber angkanya adalah pesan lama yang sudah kita kirim sendiri,
                dan mencetaknya ulang berarti nota yang dibatalkan beredar untuk kedua kalinya lengkap dengan isinya —
                kebalikan dari yang dibutuhkan.
              </Petunjuk>
            </div>
            <MessageEditor
              name="template_penjualan_hapus"
              defaultValue={nilai.templateHapus}
              variables={PENJUALAN_TEMPLATE_VARIABLES}
              rows={6}
              disabled={simpanPending}
              hint="Hanya {no_nota}, {tanggal}, dan {jam} yang terisi di sini — barisnya sudah tidak ada di Khanza saat pesan ini dirakit, jadi daftar barang dan angkanya tidak bisa dibaca lagi."
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Jendela pindai (hari)</label>
              <Petunjuk untuk="Jendela pindai">
                Berapa hari ke belakang <span className="font-medium text-foreground">dan ke depan</span> yang
                diperiksa ulang tiap siklus. Angka ini <span className="font-medium text-foreground">juga</span>{' '}
                menentukan berapa lama sebuah nota masih dipantau untuk pembatalan: nota yang lebih tua dari jendela
                tidak diperiksa lagi, jadi penghapusannya tidak dikabarkan.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="penjualan_lookback_hari"
              defaultValue={nilai.lookback}
              min={1}
              max={30}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Maksimal nota per siklus</label>
              <Petunjuk untuk="Maksimal nota per siklus">
                Dibagi bersama antara nota baru dan pembatalan, dan{' '}
                <span className="font-medium text-foreground">pembatalan didahulukan</span> — sebuah koreksi tidak
                boleh mengantre di belakang puluhan nota baru. Kelebihannya dikirim pada siklus berikutnya, tidak
                dibuang.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="penjualan_max_per_siklus"
              defaultValue={nilai.kuota}
              min={1}
              max={50}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
        </div>

        {simpan.error && <p className="text-sm text-destructive">{simpan.error}</p>}
        {simpan.sukses && <p className="text-sm text-success">{simpan.sukses}</p>}

        <Button type="submit" disabled={simpanPending}>
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan penjualan'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium">
          Lihat pesan atas nota terakhir
          <Petunjuk untuk="Pratinjau nota terakhir">
            Membaca nota terakhir yang ada di jendela lewat jalur yang sama persis dipakai worker, lalu merendernya
            dengan isi pesan <span className="font-medium text-foreground">yang sudah tersimpan</span> — bukan yang
            sedang diketik di atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
          </Petunjuk>
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}
        {pratinjau.kosong && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada nota penjualan di dalam jendela. Itu wajar bila apoteknya sedang tidak berjualan — bukan tanda ada
            yang salah.
          </p>
        )}
        {pratinjau.teks && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Nota <span className="font-medium text-foreground">{pratinjau.noNota}</span> — {pratinjau.jumlahItem}{' '}
                barang.
                {(pratinjau.jumlahPesan ?? 0) > 1 && (
                  <span className="text-warning">
                    {' '}
                    Terlalu panjang untuk satu pesan WhatsApp — akan terkirim sebagai {pratinjau.jumlahPesan} pesan
                    berturut-turut, seluruh barangnya tetap ikut.
                  </span>
                )}
              </p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                {pratinjau.teks}
              </pre>
            </div>

            {/* Pesan pembatalan dirender BERSAMAAN, dan itu bukan kelengkapan
                yang berlebihan: ia tidak punya cara lain untuk dilihat sebelum
                dipakai. Ia baru muncul saat sebuah nota benar-benar dihapus --
                22 kali dalam dua setengah tahun di sini -- jadi menunggu
                kejadian aslinya berarti bentuk pesannya pertama kali terlihat
                justru di grup, saat sudah terlambat. */}
            {pratinjau.teksHapus && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  Dan begini bunyinya bila nota itu <span className="font-medium text-foreground">dihapus</span>:
                </p>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                  {pratinjau.teksHapus}
                </pre>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
