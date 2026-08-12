'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { HIBAH_TEMPLATE_VARIABLES } from '@/core/template';
import { simpanHibahAction, pratinjauHibahAction, type HasilHibah, type HasilPratinjauHibah } from './hibahActions';

export interface NilaiHibah {
  template: string;
  nilai: boolean;
  lookback: number;
  kuota: number;
}

export function HibahForm({ nilai, adaTujuan }: { nilai: NilaiHibah; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilHibah, fd: FormData) => simpanHibahAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauHibah, fd: FormData) => pratinjauHibahAction(prev, fd),
    {},
  );

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima nota ini.</span> Centang &ldquo;Hibah&rdquo;
          pada salah satu baris di{' '}
          <Link href="/farmasi?tab=tujuan" className="font-medium underline">
            tab Tujuan pengiriman
          </Link>
          . Selama belum dicentang, penerimaan yang disimpan tidak dikirim ke mana pun.
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium">Isi pesan</label>
          <MessageEditor
            name="template_hibah"
            defaultValue={nilai.template}
            variables={HIBAH_TEMPLATE_VARIABLES}
            rows={10}
            disabled={simpanPending}
            hint="Daftar barangnya dirakit sistem dan dipasang ke {daftar_barang} — nama barang, jumlah, satuan, dan (bila dinyalakan) nilainya."
          />
        </div>

        {/* Sakelar nilai MENYALA secara bawaan, sama seperti harga pada
            pengadaan: yang diminta adalah nota penerimaan barang, dan nilai
            barang adalah bagian dari nota itu.

            Yang WAJIB dikatakan di sini adalah batasnya, karena ia gampang
            disalahpahami sebagai "matikan supaya tidak ada angka sama sekali":
            kedua TOTAL di kepala nota tetap ikut. Kalau tidak, templatenya
            menyisakan dua baris label tanpa angka. */}
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-3">
          <input
            type="checkbox"
            name="hibah_nilai"
            defaultChecked={nilai.nilai}
            disabled={simpanPending}
            className="mt-0.5"
          />
          <span className="text-xs">
            <span className="font-medium">Sertakan nilai per barang di daftar</span>
            <span className="mt-1 block text-muted-foreground">
              Saat dimatikan, nilai per barang tidak sekadar disembunyikan — kolomnya tidak dibaca sama sekali dari
              Khanza.{' '}
              <span className="font-medium text-foreground">
                Kedua total di bawah daftar tetap ikut, karena itu yang dicocokkan gudang dengan berita acara serah
                terima.
              </span>{' '}
              Kalau satu angka pun tidak boleh beredar, hapus <code>{'{total_hibah}'}</code> dan{' '}
              <code>{'{total_diakui}'}</code> dari isi pesan di atas.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Jendela pindai (hari)</label>
              <Petunjuk untuk="Jendela pindai">
                Berapa hari ke belakang <span className="font-medium text-foreground">dan ke depan</span> yang
                diperiksa ulang tiap siklus. Ke depan juga, karena nomor hibah mengikuti tanggal yang dipilih staf —
                penerimaan bertanggal pekan depan bernomor lebih besar daripada hari ini.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="hibah_lookback_hari"
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
                Kelebihannya dikirim pada siklus berikutnya, tidak dibuang. Ini yang menahan entri borongan berubah
                jadi belasan pesan beruntun ke grup yang sama.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="hibah_max_per_siklus"
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
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan hibah'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau                                                          */}
      {/* ------------------------------------------------------------------ */}
      <form action={pratinjauAction} className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium">
          Lihat pesan atas penerimaan terakhir
          <Petunjuk untuk="Pratinjau penerimaan terakhir">
            Membaca penerimaan terakhir lewat jalur yang sama persis dipakai worker, lalu merendernya dengan isi pesan{' '}
            <span className="font-medium text-foreground">yang sudah tersimpan</span> — bukan yang sedang diketik di
            atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
          </Petunjuk>
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}

        {/* DUA keadaan kosong yang berbeda, dan pembedaannya bukan kehalusan:
            "belum ada yang baru" berarti fiturnya siap, "belum pernah sama
            sekali" berarti menyalakan sakelarnya tidak akan mengirim apa pun.
            Tanpa dibedakan, keduanya terbaca sama dan staf menyimpulkan
            fiturnya rusak. */}
        {pratinjau.belumPernah && (
          <p className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            <span className="font-medium">
              Belum ada satu pun penerimaan hibah yang tercatat di Khanza rumah sakit ini.
            </span>{' '}
            Bukan tanda ada yang salah — menu <span className="font-medium">Hibah Obat &amp; BHP</span> memang belum
            pernah dipakai. Selama itu belum berubah, menyalakan sakelarnya tidak akan mengirim apa pun.
          </p>
        )}
        {pratinjau.kosong && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada penerimaan hibah di dalam jendela. Itu wajar bila belum ada hibah belakangan ini — bukan tanda
            ada yang salah.
          </p>
        )}
        {pratinjau.teks && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-muted-foreground">
              Nota <span className="font-medium text-foreground">{pratinjau.noHibah}</span> — {pratinjau.jumlahItem}{' '}
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
