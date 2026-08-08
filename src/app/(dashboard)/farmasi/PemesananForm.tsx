'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor } from '@/components/ui';
import { PEMESANAN_TEMPLATE_VARIABLES } from '@/core/template';
import {
  simpanPemesananAction,
  pratinjauPemesananAction,
  type HasilPemesanan,
  type HasilPratinjauPemesanan,
} from './pemesananActions';

export interface NilaiPemesanan {
  template: string;
  harga: boolean;
  lookback: number;
  kuota: number;
}

export function PemesananForm({ nilai, adaTujuan }: { nilai: NilaiPemesanan; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilPemesanan, fd: FormData) => simpanPemesananAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauPemesanan, fd: FormData) => pratinjauPemesananAction(prev, fd),
    {},
  );

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima nota ini.</span> Centang
          &ldquo;Pemesanan&rdquo; pada salah satu baris di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          . Selama belum dicentang, pesanan yang disimpan tidak dikirim ke mana pun.
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium">Isi pesan</label>
          <MessageEditor
            name="template_pemesanan"
            defaultValue={nilai.template}
            variables={PEMESANAN_TEMPLATE_VARIABLES}
            rows={10}
            disabled={simpanPending}
            hint="Daftar barangnya dirakit sistem dan dipasang ke {daftar_barang} — nama barang, jumlah, satuan, dan (bila dinyalakan) harganya."
          />
        </div>

        {/* Sakelar harga MENYALA secara bawaan, sama seperti pada pengadaan dan
            hibah: yang diminta adalah surat pesanan, dan harga adalah bagian
            dari surat pesanan.

            Yang WAJIB dikatakan di sini adalah batasnya, karena ia gampang
            disalahpahami sebagai "matikan supaya tidak ada angka sama sekali":
            kelima angka di kepala/kaki nota tetap ikut. Kalau tidak,
            templatenya menyisakan lima baris label tanpa angka. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-3">
          <input
            type="checkbox"
            name="pemesanan_harga"
            defaultChecked={nilai.harga}
            disabled={simpanPending}
            className="mt-0.5"
          />
          <span className="text-xs">
            <span className="font-medium">Sertakan harga per barang di daftar</span>
            <span className="mt-1 block text-muted-foreground">
              Saat dimatikan, harga per barang tidak sekadar disembunyikan — kolomnya tidak dibaca sama sekali dari
              Khanza.{' '}
              <span className="font-medium text-foreground">
                Angka penutup di bawah daftar tetap ikut, karena itu yang dicocokkan dengan penawaran pemasok.
              </span>{' '}
              Kalau satu angka pun tidak boleh beredar, hapus <code>{'{total}'}</code>, <code>{'{potongan}'}</code>,{' '}
              <code>{'{ppn}'}</code>, <code>{'{meterai}'}</code>, dan <code>{'{tagihan}'}</code> dari isi pesan di
              atas.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Jendela pindai (hari)</label>
            <Input
              type="number"
              name="pemesanan_lookback_hari"
              defaultValue={nilai.lookback}
              min={1}
              max={30}
              fieldSize="sm"
              disabled={simpanPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Berapa hari ke belakang <span className="font-medium text-foreground">dan ke depan</span> yang diperiksa
              ulang tiap siklus. Ke depan juga, karena nomor pesanan mengikuti tanggal yang dipilih staf — pesanan
              bertanggal pekan depan bernomor lebih besar daripada hari ini.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Maksimal nota per siklus</label>
            <Input
              type="number"
              name="pemesanan_max_per_siklus"
              defaultValue={nilai.kuota}
              min={1}
              max={50}
              fieldSize="sm"
              disabled={simpanPending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Kelebihannya dikirim pada siklus berikutnya, tidak dibuang. Ini yang menahan entri borongan berubah jadi
              belasan pesan beruntun ke grup yang sama.
            </p>
          </div>
        </div>

        {simpan.error && <p className="text-sm text-destructive">{simpan.error}</p>}
        {simpan.sukses && <p className="text-sm text-success">{simpan.sukses}</p>}

        <Button type="submit" disabled={simpanPending}>
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan pemesanan'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 text-xs font-medium">Lihat pesan atas pesanan terakhir</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Membaca pesanan terakhir lewat jalur yang sama persis dipakai worker, lalu merendernya dengan isi pesan{' '}
          <span className="font-medium text-foreground">yang sudah tersimpan</span> — bukan yang sedang diketik di
          atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}

        {/* TIGA keadaan kosong yang berbeda, dan pembedaannya bukan kehalusan:
            "belum ada yang baru" berarti fiturnya siap, "belum pernah sama
            sekali" berarti menyalakan sakelarnya tidak akan mengirim apa pun,
            dan "tanpa rincian" berarti worker akan MELEWATINYA. Tanpa
            dibedakan, ketiganya terbaca sama dan staf menyimpulkan fiturnya
            rusak. */}
        {pratinjau.belumPernah && (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            <span className="font-medium">
              Belum ada satu pun surat pemesanan yang tercatat di Khanza rumah sakit ini.
            </span>{' '}
            Bukan tanda ada yang salah — menu <span className="font-medium">Surat Pemesanan Obat &amp; BHP</span> memang
            belum pernah dipakai. Selama itu belum berubah, menyalakan sakelarnya tidak akan mengirim apa pun.
          </p>
        )}
        {pratinjau.tanpaRincian && (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            Pesanan <span className="font-medium">{pratinjau.noPemesanan}</span> tersimpan{' '}
            <span className="font-medium">tanpa satu baris barang pun</span>. Nota semacam itu sengaja{' '}
            <span className="font-medium">tidak dikirim</span> — pesannya akan berbunyi &ldquo;Barang (0):&rdquo; lalu
            kosong diikuti angka tagihan, yang terbaca sebagai sistem rusak. Ia akan terkirim sendiri begitu barangnya
            diisi di Khanza, selama masih di dalam jendela pindai.
          </p>
        )}
        {pratinjau.kosong && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada pesanan di dalam jendela. Itu wajar bila belum ada pemesanan belakangan ini — bukan tanda ada
            yang salah.
          </p>
        )}
        {pratinjau.teks && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted-foreground">
              Nota <span className="font-medium text-foreground">{pratinjau.noPemesanan}</span> —{' '}
              {pratinjau.jumlahItem} barang.
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
