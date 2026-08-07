'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor } from '@/components/ui';
import { PENGADAAN_TEMPLATE_VARIABLES } from '@/core/template';
import {
  simpanPengadaanAction,
  pratinjauPengadaanAction,
  type HasilPengadaan,
  type HasilPratinjauPengadaan,
} from './pengadaanActions';

export interface NilaiPengadaan {
  template: string;
  harga: boolean;
  lookback: number;
  kuota: number;
}

export function PengadaanForm({ nilai, adaTujuan }: { nilai: NilaiPengadaan; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilPengadaan, fd: FormData) => simpanPengadaanAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauPengadaan, fd: FormData) => pratinjauPengadaanAction(prev, fd),
    {},
  );

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima nota ini.</span>{' '}
          Centang &ldquo;Pengadaan&rdquo; pada salah satu baris di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          . Selama belum dicentang, pembelian yang disimpan tidak dikirim ke mana pun.
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium">Isi pesan</label>
          <MessageEditor
            name="template_pengadaan"
            defaultValue={nilai.template}
            variables={PENGADAAN_TEMPLATE_VARIABLES}
            rows={10}
            disabled={simpanPending}
            hint="Daftar barangnya dirakit sistem dan dipasang ke {daftar_barang} — nama barang, jumlah, satuan, dan (bila dinyalakan) harga belinya."
          />
        </div>

        {/* Sakelar harga MENYALA secara bawaan, berbeda dari kebanyakan sakelar
            di sistem ini. Alasannya ditulis di sini, bukan cuma di migrasi:
            yang diminta adalah nota pembelian, dan nota tanpa harga bukan nota.
            Yang perlu dikatakan justru KONSEKUENSINYA, karena harga beli
            pemasok punya nilai dagang tersendiri dan grup bukan sistem
            tertutup. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-3">
          <input
            type="checkbox"
            name="pengadaan_harga"
            defaultChecked={nilai.harga}
            disabled={simpanPending}
            className="mt-0.5"
          />
          <span className="text-xs">
            <span className="font-medium">Sertakan harga beli di daftar barang</span>
            <span className="mt-1 block text-muted-foreground">
              Saat dimatikan, harga tidak sekadar disembunyikan — kolomnya tidak dibaca sama sekali dari Khanza.{' '}
              <span className="font-medium text-foreground">
                Harga beli dari pemasok punya nilai dagang tersendiri
              </span>
              ; pertimbangkan siapa saja yang ada di dalam grup tujuan. Angka total dan tagihan tetap ikut, karena
              itulah yang dicocokkan gudang dengan nota pemasok.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Jendela pindai (hari)</label>
            <Input
              type="number"
              name="pengadaan_lookback_hari"
              defaultValue={nilai.lookback}
              min={1}
              max={30}
              fieldSize="sm"
              disabled={simpanPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Berapa hari ke belakang <span className="font-medium text-foreground">dan ke depan</span> yang diperiksa
              ulang tiap siklus. Ke depan juga, karena nomor faktur mengikuti tanggal beli yang dipilih staf — nota
              bertanggal pekan depan bernomor lebih besar daripada hari ini.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Maksimal faktur per siklus</label>
            <Input
              type="number"
              name="pengadaan_max_per_siklus"
              defaultValue={nilai.kuota}
              min={1}
              max={50}
              fieldSize="sm"
              disabled={simpanPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Kelebihannya dikirim pada siklus berikutnya, tidak dibuang. Ini yang menahan entri borongan setelah libur
              panjang berubah jadi belasan pesan beruntun ke grup yang sama.
            </p>
          </div>
        </div>

        {simpan.error && <p className="text-sm text-destructive">{simpan.error}</p>}
        {simpan.sukses && <p className="text-sm text-success">{simpan.sukses}</p>}

        <Button type="submit" disabled={simpanPending}>
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan pengadaan'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 text-xs font-medium">Lihat pesan atas faktur terakhir</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Membaca pembelian terakhir yang ada di jendela lewat jalur yang sama persis dipakai worker, lalu
          merendernya dengan isi pesan{' '}
          <span className="font-medium text-foreground">yang sudah tersimpan</span> — bukan yang sedang diketik di
          atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}
        {pratinjau.kosong && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada faktur pembelian di dalam jendela. Itu wajar bila belum ada pengadaan belakangan ini — bukan
            tanda ada yang salah.
          </p>
        )}
        {pratinjau.teks && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted-foreground">
              Faktur <span className="font-medium text-foreground">{pratinjau.noFaktur}</span> — {pratinjau.jumlahItem}{' '}
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
        )}
      </form>
    </div>
  );
}
