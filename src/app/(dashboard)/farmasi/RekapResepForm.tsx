'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { REKAP_RESEP_TEMPLATE_VARIABLES } from '@/core/template';
import {
  simpanRekapResepAction,
  pratinjauRekapResepAction,
  type HasilRekapResep,
  type HasilPratinjauRekapResep,
} from './resepRekapActions';

export interface NilaiRekapResep {
  jam: string;
  offset: number;
  template: string;
  templateKosong: string;
}

/**
 * Kalimat yang membacakan akibat setelan jam + offset.
 *
 * Ini bagian terpenting form ini, bukan hiasan. Sistem TIDAK BISA menyimpulkan
 * hari mana yang dimaksud dari jamnya sendiri: 22:00 jelas memaksudkan hari itu
 * juga, 07:00 jelas memaksudkan kemarin, dan menebaknya berarti mengirim rekap
 * yang isinya nyaris kosong tanpa satu pun galat. Jadi dua setelannya berdiri
 * sendiri -- dan dua setelan yang bisa saling bertentangan wajib dibacakan
 * akibatnya, bukan cuma ditampilkan angkanya.
 *
 * Peringatan pada kombinasi pagi + offset 0 berangkat dari pengukuran: peresepan
 * di RS ini berlangsung pukul 08:00-20:00 dengan puncaknya pukul 17:00, jadi
 * rekap "hari ini" yang dikirim sebelum siang hampir selalu memuat sebagian kecil
 * hari itu -- benar secara harfiah, dan menyesatkan sebagai laporan.
 *
 * Yang KEDUA, dan ia tidak punya padanan di rekap penjualan: peresepan punya ekor
 * tipis yang menembus tengah malam (jam 21 = 12, jam 22 = 2, jam 23 = 1 sepanjang
 * 2,5 tahun). Jadi offset 0 pada jam berapa pun bisa melewatkan resep yang ditulis
 * SESUDAH rekapnya berangkat, dan itu harus dikatakan alih-alih ditemukan
 * belakangan sebagai angka yang tidak cocok.
 */
function Akibat({ jam, offset }: { jam: string; offset: number }) {
  const cocok = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(jam);
  if (!cocok) {
    return (
      <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
        Jam kirim belum berbentuk <span className="font-medium">HH:MM</span> &mdash; mis. <code>22:00</code>.
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
    <div
      className={`mt-2 rounded-md border p-2 text-xs ${pagi ? 'border-warning/40 bg-warning/5' : 'border-border bg-background/50'}`}
    >
      <p>
        Setiap hari pukul <span className="font-medium">{jamRapi}</span>, sistem mengirim rekap resep{' '}
        <span className="font-medium">{hari}</span>.
      </p>
      {pagi && (
        <p className="mt-1 text-muted-foreground">
          Jam sepagi ini dengan &ldquo;hari ini&rdquo; berarti rekapnya memuat resep yang{' '}
          <span className="font-medium text-foreground">baru berjalan beberapa jam</span>. Peresepan di sini berlangsung
          pukul 08.00&ndash;20.00 dengan puncaknya pukul 17.00 (diukur 90 hari), jadi angkanya akan selalu jauh lebih
          kecil daripada hari penuh. Untuk jam pagi, pilih <span className="font-medium text-foreground">1</span> supaya
          yang direkap adalah hari kemarin yang sudah lengkap.
        </p>
      )}
      {offset === 0 && !pagi && (
        <p className="mt-1 text-muted-foreground">
          Resep yang ditulis <span className="font-medium text-foreground">sesudah</span> pukul {jamRapi} tidak ikut
          terhitung. Jarang, tapi bukan mustahil &mdash; sepanjang 2,5 tahun tercatat 12 resep setelah pukul 21.00 dan
          yang paling malam pukul 23.11. Kalau tidak boleh ada satu pun yang terlewat, pakai jam pagi dengan{' '}
          <span className="font-medium text-foreground">1</span>.
        </p>
      )}
    </div>
  );
}

export function RekapResepForm({ nilai, adaTujuan }: { nilai: NilaiRekapResep; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilRekapResep, fd: FormData) => simpanRekapResepAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauRekapResep, fd: FormData) => pratinjauRekapResepAction(prev, fd),
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
          <span className="font-medium"> aktif</span> &mdash; daftar yang sama dengan notifikasi resep. Aktifkan di{' '}
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
              <Petunjuk untuk="Jam kirim rekap resep">
                Bawaannya <span className="font-medium text-foreground">22.00</span>, dan itu diukur &mdash; sengaja
                lebih malam daripada rekap penjualan (21.00). Peresepan masih terjadi sampai pukul 20.00 dengan ekor
                tipis yang menembus tengah malam, sementara penjualan benar-benar berhenti pukul 20.00.
              </Petunjuk>
            </div>
            <Input
              type="time"
              name="resep_rekap_jam"
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
                <span className="font-medium text-foreground">1</span> = kemarin. Pilih 1 bila tidak boleh ada satu resep
                pun yang terlewat &mdash; hari kemarin selalu sudah lengkap.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="resep_rekap_offset_hari"
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
            <Petunjuk untuk="Isi pesan rekap resep">
              Variabelnya <span className="font-medium text-foreground">berbeda</span> dari isi pesan notifikasi di
              atas: semuanya angka sehari penuh, bukan satu resep. Yang menyebut satu resep ({'{no_resep}'},{' '}
              {'{nama_pasien}'}, {'{no_rm}'}) memang tidak tersedia di sini &mdash; pada agregat sehari keduanya tidak
              punya arti, dan ketiadaannya sekaligus yang membuat rekap ini tidak pernah menyebut seorang pasien pun.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_resep_rekap"
            defaultValue={nilai.template}
            variables={REKAP_RESEP_TEMPLATE_VARIABLES}
            rows={12}
            disabled={simpanPending}
            hint="Rincian per dokter dirakit sistem dan dipasang ke {rincian_dokter} — satu baris per dokter, berisi jumlah resep, baris obat, dan rupiahnya."
          />

          {/* Rupiah adalah satu-satunya angka di rekap ini yang tidak datang dari
              tabel resep, jadi dari mana asalnya harus bisa ditanyakan di tempat
              staf memutuskan mau memakainya atau tidak. Dan karena tidak ada
              sakelarnya (lihat migrations/043), jalan keluarnya -- menghapus
              barisnya -- harus disebut di sini, bukan cuma di komentar kode. */}
          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{'{nilai_obat}'}</span> adalah rupiah yang sudah masuk
              penagihan, bukan harga daftar.
            </span>
            <Petunjuk untuk="Nilai obat pada rekap resep">
              Dijumlahkan dari angka yang <span className="font-medium text-foreground">dibekukan Khanza</span> saat
              apotek memvalidasi resep &mdash; jadi rekap tanggal lampau tetap menyebut angka yang benar-benar
              ditagihkan. Harga daftar sengaja tidak dipakai: ia berubah sewaktu-waktu, sehingga rekap kemarin bisa
              menyebut angka yang tidak pernah ditagihkan ke siapa pun.
              <br />
              <br />
              Resep yang <span className="font-medium text-foreground">belum divalidasi</span> apotek belum punya
              angka, jadi ia terhitung sebagai resep tapi menyumbang Rp0. Jarang &mdash; terukur 5 dari 9.038 resep
              dalam 90 hari.
              <br />
              <br />
              Tidak ada sakelar untuk mematikannya. Kalau rupiah tidak boleh beredar, hapus baris{' '}
              <span className="font-medium text-foreground">{'{nilai_obat}'}</span> dari isi pesan di atas; hapus juga{' '}
              <span className="font-medium text-foreground">{'{rincian_dokter}'}</span> bila angka per dokter pun tidak
              diinginkan.
            </Petunjuk>
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">
              Isi pesan saat tidak ada resep sama sekali <span className="text-muted-foreground">(opsional)</span>
            </label>
            {/* Kosong = diam, dan bawaannya memang kosong. Tapi di sini
                keterangannya menyebut satu angka yang tidak dipunyai padanannya
                di tab Penjualan: hari Minggu nol resep pada SELURUH 90 hari,
                jadi mengisinya berarti satu pesan "tidak ada resep" tiap pekan
                selamanya -- persis laju yang membuat pesan berhenti dibaca. */}
            <Petunjuk untuk="Isi pesan saat tidak ada resep">
              Dikosongkan, hari tanpa resep lewat tanpa pesan. Diisi, ia jadi tanda hidup: apotek yang biasanya menerima
              25&ndash;30 resep sehari lalu mendapat &ldquo;tidak ada resep&rdquo; tahu ada yang perlu diperiksa.{' '}
              <span className="font-medium text-foreground">Tapi perhatikan</span>: hari Minggu nol resep pada seluruh
              90 hari terakhir, jadi mengisinya berarti menerima pesan ini setiap pekan &mdash; dan pesan mingguan yang
              isinya &ldquo;tidak ada apa-apa&rdquo; cepat berhenti dibaca.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_resep_rekap_kosong"
            defaultValue={nilai.templateKosong}
            variables={REKAP_RESEP_TEMPLATE_VARIABLES}
            rows={5}
            disabled={simpanPending}
            hint="Dibiarkan kosong = sistem DIAM pada hari tanpa resep (termasuk setiap hari Minggu)."
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
          <Petunjuk untuk="Pratinjau rekap resep harian">
            Membaca resep lewat jalur yang sama persis dipakai worker, lalu merendernya dengan isi pesan{' '}
            <span className="font-medium text-foreground">yang sudah tersimpan</span> &mdash; bukan yang sedang diketik
            di atas, jadi simpan dulu untuk melihat perubahan. Tidak mengirim apa pun.
          </Petunjuk>
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
          {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
        </Button>

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}

        {/* Hari tanpa resep + pesan kosong yang sengaja diam. Dikatakan
            eksplisit: pratinjau yang tidak menampilkan apa pun terbaca sebagai
            fitur rusak, padahal itu justru perilaku yang diminta. Hari Minggu
            disebut karena itulah sebab yang paling mungkin. */}
        {pratinjau.diam && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada resep pada <span className="font-medium text-foreground">{pratinjau.tanggal}</span>, dan isi pesan
            saat kosong dibiarkan kosong &mdash; jadi pada hari seperti ini sistem sengaja tidak mengirim apa pun. Kalau
            tanggal itu hari Minggu, itu memang keadaan yang wajar di sini.
          </p>
        )}

        {pratinjau.teks && (
          <div className="mt-3">
            {/* Tanggalnya WAJIB disebut. Rekap yang isinya mengejutkan tidak bisa
                dibedakan dari query yang salah tanpa tahu hari mana yang dibaca. */}
            <p className="mb-1 text-xs text-muted-foreground">
              Resep tanggal <span className="font-medium text-foreground">{pratinjau.tanggal}</span> &mdash;{' '}
              {pratinjau.jumlahResep} resep.
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
