'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, ConfirmDialog, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { REKAP_BULANAN_TEMPLATE_VARIABLES } from '@/core/template';
import { TANGGAL_KIRIM_MIN, TANGGAL_KIRIM_MAKS } from '@/core/rekapBulan';
import {
  simpanBulananAction,
  pratinjauBulananAction,
  kirimUjiBulananAction,
  type HasilBulanan,
  type HasilPratinjauBulanan,
} from './bulananActions';

export interface NilaiBulanan {
  tanggal: number;
  jam: string;
  template: string;
  templateKosong: string;
}

const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Kalimat yang membacakan akibat setelan tanggal + jam.
 *
 * Bagian terpenting form ini, bukan hiasan -- pola yang sama dengan `Akibat` pada
 * rekap harian resep, tapi yang perlu dibacakan di sini BERBEDA. Di sana yang
 * ambigu adalah HARI MANA yang direkap; di sini periodenya tidak ambigu sama
 * sekali (selalu bulan sebelumnya), dan yang perlu dibacakan justru bulan
 * SUNGGUHAN yang akan tiba pada kiriman berikutnya. "Tanggal 3" tidak memberi
 * tahu siapa pun bahwa yang datang tanggal 3 Januari adalah rekap Desember.
 */
function Akibat({ tanggal, jam }: { tanggal: number; jam: string }) {
  const cocok = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(jam);
  if (!cocok) {
    return (
      <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
        Jam kirim belum berbentuk <span className="font-medium">HH:MM</span> &mdash; mis. <code>08:00</code>.
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

  const sah = Number.isInteger(tanggal) && tanggal >= TANGGAL_KIRIM_MIN && tanggal <= TANGGAL_KIRIM_MAKS;
  if (!sah) {
    return (
      <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
        Tanggal kirim harus antara {TANGGAL_KIRIM_MIN} dan {TANGGAL_KIRIM_MAKS}.{' '}
        <span className="font-medium">Tanggal 29&ndash;31 tidak dipakai</span> karena Februari tidak punya tanggal itu
        &mdash; jadwalnya akan melewatkan satu bulan setiap tahun tanpa satu pun galat.
      </p>
    );
  }

  const jamRapi = `${String(j).padStart(2, '0')}.${String(m).padStart(2, '0')}`;

  /**
   * Contoh yang DIHITUNG dari hari ini, bukan dua nama bulan yang ditulis mati.
   *
   * Yang perlu dibuktikan ke pembaca adalah bahwa periodenya SELALU bulan
   * sebelumnya, dan contoh yang bergerak mengikuti kalender jauh lebih meyakinkan
   * daripada kalimat aturan. Ia sekaligus memperlihatkan perilaku pergantian
   * tahun tanpa perlu menjelaskannya.
   */
  const kini = new Date();
  const berikut = new Date(kini.getFullYear(), kini.getMonth(), 1);
  if (kini.getDate() >= tanggal) berikut.setMonth(berikut.getMonth() + 1);
  const direkap = new Date(berikut.getFullYear(), berikut.getMonth() - 1, 1);

  return (
    <div className="mt-2 rounded-md border border-border bg-background/50 p-2 text-xs">
      <p>
        Setiap tanggal <span className="font-medium">{tanggal}</span> pukul{' '}
        <span className="font-medium">{jamRapi}</span>, sistem mengirim rekap{' '}
        <span className="font-medium">bulan sebelumnya</span>.
      </p>
      <p className="mt-1 text-muted-foreground">
        Kiriman berikutnya:{' '}
        <span className="font-medium text-foreground">
          {tanggal} {NAMA_BULAN[berikut.getMonth()]} {berikut.getFullYear()}
        </span>
        , berisi rekap{' '}
        <span className="font-medium text-foreground">
          {NAMA_BULAN[direkap.getMonth()]} {direkap.getFullYear()}
        </span>
        .
      </p>
      {tanggal === 1 && (
        <p className="mt-1 text-muted-foreground">
          Tanggal 1 berarti rekapnya berangkat pada hari pertama bulan baru. Transaksi akhir bulan yang baru dientri
          hari kerja berikutnya <span className="font-medium text-foreground">tidak akan ikut terhitung</span> &mdash;
          pilih tanggal 3&ndash;5 kalau entri sering menyusul.
        </p>
      )}
    </div>
  );
}

export function BulananForm({ nilai, adaTujuan }: { nilai: NilaiBulanan; adaTujuan: boolean }) {
  const [simpan, simpanAction, simpanPending] = useActionState(
    async (prev: HasilBulanan, fd: FormData) => simpanBulananAction(prev, fd),
    {},
  );
  const [pratinjau, pratinjauAction, pratinjauPending] = useActionState(
    async (prev: HasilPratinjauBulanan, fd: FormData) => pratinjauBulananAction(prev, fd),
    {},
  );

  // Dikendalikan state HANYA supaya kalimat akibatnya ikut berubah saat diketik.
  // Nilainya tetap dibaca server dari FormData, bukan dari state ini.
  const [tanggal, setTanggal] = useState(nilai.tanggal);
  const [jam, setJam] = useState(nilai.jam);

  const [mengujiTerbuka, setMengujiTerbuka] = useState(false);
  const [hasilUji, setHasilUji] = useState<HasilBulanan>({});
  const [ujiPending, startUji] = useTransition();

  return (
    <div className="space-y-6">
      {!adaTujuan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <span className="font-medium">Belum ada tujuan yang menerima rekap ini.</span> Rekap bulanan dikirim ke tujuan
          yang mencentang <span className="font-medium">&ldquo;Terima rekap bulanan&rdquo;</span> &mdash; centang
          TERSENDIRI, bukan daftar yang sama dengan notifikasi resep. Centang di{' '}
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
              <label className="text-xs font-medium">Tanggal kirim</label>
              <Petunjuk untuk="Tanggal kirim rekap bulanan">
                Tanggal berapa dalam bulan rekapnya dikirim. Bawaannya{' '}
                <span className="font-medium text-foreground">3</span>, bukan 1: transaksi akhir bulan kadang baru
                dientri hari kerja pertama bulan berikutnya, dan rekap tanggal 1 akan melewatkannya.
                <br />
                <br />
                Dibatasi <span className="font-medium text-foreground">1&ndash;28</span> karena Februari tidak punya
                tanggal 29&ndash;31 &mdash; jadwal &ldquo;tiap tanggal 30&rdquo; akan melewatkan satu bulan setiap tahun
                tanpa satu pun galat, dan yang terlihat cuma rekap Februari yang tidak pernah datang.
              </Petunjuk>
            </div>
            <Input
              type="number"
              name="bulanan_tanggal"
              value={tanggal}
              onChange={(e) => setTanggal(Number(e.target.value))}
              min={TANGGAL_KIRIM_MIN}
              max={TANGGAL_KIRIM_MAKS}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Jam kirim</label>
              <Petunjuk untuk="Jam kirim rekap bulanan">
                Bawaannya <span className="font-medium text-foreground">08.00</span> &mdash; pagi hari kerja. Berbeda
                dari rekap harian yang jamnya malam (21.00 penjualan, 22.00 resep), dan sebabnya bukan selera: jam malam
                di sana dipilih supaya rekapnya tidak melewatkan transaksi yang masih berjalan hari itu. Di sini
                periodenya sudah tutup berhari-hari, jadi satu-satunya yang menentukan adalah kapan orang membacanya.
              </Petunjuk>
            </div>
            <Input
              type="time"
              name="bulanan_jam"
              value={jam}
              onChange={(e) => setJam(e.target.value)}
              fieldSize="sm"
              disabled={simpanPending}
            />
          </div>
        </div>

        <Akibat tanggal={tanggal} jam={jam} />

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">Isi pesan rekap</label>
            <Petunjuk untuk="Isi pesan rekap bulanan">
              Variabelnya <span className="font-medium text-foreground">berbeda</span> dari rekap harian: semuanya angka
              SEBULAN penuh, dan ia juga membawa keempat jalur barang (pengadaan, pemesanan, hibah, penjualan) yang
              tidak ada di rekap harian mana pun.
              <br />
              <br />
              Yang tidak tersedia, dan ketiadaannya disengaja: {'{nama_pasien}'}, {'{no_rm}'}, {'{no_resep}'}, nama obat,
              dan nama pemasok. Rekap ini seluruhnya angka.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_bulanan"
            defaultValue={nilai.template}
            variables={REKAP_BULANAN_TEMPLATE_VARIABLES}
            rows={16}
            disabled={simpanPending}
            hint="{rincian_mutu} dan {rincian_barang} dirakit sistem — masing-masing beberapa baris siap pakai."
          />

          {/* Dua variabel yang paling mudah disalahpahami, dan keduanya bisa
              membuat angka yang dilaporkan ke manajemen meleset tanpa ada yang
              menyadarinya. */}
          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{'{jumlah_pasien}'}</span> dan{' '}
              <span className="font-medium text-foreground">{'{jumlah_kunjungan}'}</span> BUKAN angka yang sama.
            </span>
            <Petunjuk untuk="Pasien versus kunjungan">
              <span className="font-medium text-foreground">Kunjungan</span> menghitung berapa kali resep ditulis;{' '}
              <span className="font-medium text-foreground">pasien</span> menghitung berapa ORANG berbeda yang
              menerimanya. Pasien yang berobat tiga kali sebulan terhitung tiga kunjungan tapi satu pasien.
              <br />
              <br />
              Selisihnya nyata: pada Juli 2026 terukur{' '}
              <span className="font-medium text-foreground">634 kunjungan dari 541 pasien</span> &mdash; beda 15%.
              Memakai yang satu dengan label yang satunya berarti angka laporan meleset sebanyak itu setiap bulan, tanpa
              satu pun galat.
            </Petunjuk>
          </p>

          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{'{rincian_mutu}'}</span> memuat ketiga angka &ldquo;yang
              belum&rdquo; berikut persentasenya.
            </span>
            <Petunjuk untuk="Rincian mutu">
              Berapa resep yang belum divalidasi apotek, belum diserahkan ke pasien, dan belum ditelaah.
              Persentasenya ikut karena angka telanjang tidak bisa dinilai tanpa pembaginya: 175 belum diserahkan berarti
              hal yang sangat berbeda pada bulan 685 resep dan pada bulan 3.000 resep.
              <br />
              <br />
              Inilah bagian yang paling bergerak di sini, dan yang cuma terlihat dari rekap BULANAN: &ldquo;belum
              diserahkan&rdquo; terukur naik dari 9 (Februari) ke 175 (Juli), &ldquo;belum ditelaah&rdquo; dari 30 ke
              145. Rekap harian menampilkan satu angka tanpa pembanding, sehingga kenaikan sepelan ini tidak pernah
              terbaca sebagai kenaikan.
            </Petunjuk>
          </p>

          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              Pemesanan dan hibah akan berbunyi <span className="font-medium text-foreground">0</span> di sini.
            </span>
            <Petunjuk untuk="Kenapa pemesanan dan hibah nol">
              Terukur nol pada setiap bulan di instalasi ini: menu{' '}
              <span className="font-medium text-foreground">Surat Pemesanan</span> tercatat satu surat dalam lebih dari
              dua tahun, dan <span className="font-medium text-foreground">Hibah Obat &amp; BHP</span> belum pernah
              dipakai sama sekali.
              <br />
              <br />
              Keduanya tetap ditampilkan sebagai 0 dan bukan disembunyikan: nol di sini bukan sifat struktural melainkan
              keadaan yang bisa berubah, dan hari gudang mulai memakai menunya adalah hari angkanya mulai berarti.
              Disembunyikan, &ldquo;tidak ada pesanan&rdquo; tidak bisa dibedakan dari &ldquo;fiturnya tidak membaca
              pesanan&rdquo;.
            </Petunjuk>
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">
              Isi pesan saat bulan itu tidak ada kegiatan apa pun{' '}
              <span className="text-muted-foreground">(opsional)</span>
            </label>
            <Petunjuk untuk="Isi pesan saat bulan kosong">
              Dipakai HANYA bila bulan itu nol resep, nol pengadaan, nol pemesanan, nol hibah,{' '}
              <span className="font-medium text-foreground">dan</span> nol penjualan sekaligus &mdash; artinya apotek
              benar-benar tutup sebulan penuh.
              <br />
              <br />
              Berbeda dari rekap harian, mengisinya di sini masuk akal: keadaan seaneh itu tidak akan pernah jadi
              kebisingan. Bandingkan pesan &ldquo;tidak ada resep&rdquo; harian, yang di sini akan terkirim setiap hari
              Minggu.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_bulanan_kosong"
            defaultValue={nilai.templateKosong}
            variables={REKAP_BULANAN_TEMPLATE_VARIABLES}
            rows={4}
            disabled={simpanPending}
            hint="Dibiarkan kosong = sistem DIAM pada bulan tanpa satu pun kegiatan farmasi."
          />
        </div>

        {simpan.error && <p className="text-sm text-destructive">{simpan.error}</p>}
        {simpan.sukses && <p className="text-sm text-success">{simpan.sukses}</p>}

        <Button type="submit" disabled={simpanPending}>
          {simpanPending ? 'Menyimpan...' : 'Simpan pengaturan rekap bulanan'}
        </Button>
      </form>

      {/* ------------------------------------------------------------------ */}
      {/* Pratinjau + kirim uji                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-border/60 p-3">
        <p className="mb-2 flex items-center gap-1 text-xs font-medium">
          Buktikan sebelum menunggu jadwalnya
          <Petunjuk untuk="Pratinjau dan kirim uji">
            Keduanya membaca lewat jalur yang sama persis dipakai worker, dan memakai isi pesan{' '}
            <span className="font-medium text-foreground">yang sudah tersimpan</span> &mdash; bukan yang sedang diketik
            di atas, jadi simpan dulu untuk melihat perubahan.
            <br />
            <br />
            <span className="font-medium text-foreground">Pratinjau</span> menampilkannya di layar ini saja.{' '}
            <span className="font-medium text-foreground">Kirim rekap uji</span> benar-benar mengirimnya ke tujuan
            &mdash; itu satu-satunya cara membuktikan pesannya TIBA, karena kiriman ke kode grup yang salah pun tetap
            tercatat berhasil.
          </Petunjuk>
        </p>

        <div className="flex flex-wrap gap-2">
          <form action={pratinjauAction}>
            <Button type="submit" variant="secondary" size="sm" disabled={pratinjauPending}>
              {pratinjauPending ? 'Membaca...' : 'Tampilkan pratinjau'}
            </Button>
          </form>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={ujiPending}
            onClick={() => setMengujiTerbuka(true)}
          >
            {ujiPending ? 'Mengirim...' : 'Kirim rekap uji'}
          </Button>
        </div>

        {hasilUji.error && <p className="mt-2 text-xs text-destructive">{hasilUji.error}</p>}
        {hasilUji.sukses && <p className="mt-2 text-xs text-success">{hasilUji.sukses}</p>}

        {pratinjau.error && <p className="mt-2 text-xs text-destructive">{pratinjau.error}</p>}

        {/* Bulan tanpa kegiatan + pesan kosong yang sengaja diam. Dikatakan
            eksplisit: pratinjau yang tidak menampilkan apa pun terbaca sebagai
            fitur rusak, padahal itu justru perilaku yang diminta. */}
        {pratinjau.diam && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada satu pun kegiatan farmasi pada{' '}
            <span className="font-medium text-foreground">{pratinjau.bulan}</span>, dan isi pesan saat bulan kosong
            dibiarkan kosong &mdash; jadi pada bulan seperti ini sistem sengaja tidak mengirim apa pun.
          </p>
        )}

        {pratinjau.teks && (
          <div className="mt-3">
            {/* Bulannya WAJIB disebut. Rekap yang isinya mengejutkan tidak bisa
                dibedakan dari query yang salah tanpa tahu periode mana yang dibaca. */}
            <p className="mb-1 text-xs text-muted-foreground">
              Periode <span className="font-medium text-foreground">{pratinjau.bulan}</span> &mdash;{' '}
              {pratinjau.jumlahResep} resep.
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
              {pratinjau.teks}
            </pre>
          </div>
        )}
      </div>

      {/*
        Dikonfirmasi lebih dulu, berbeda dari tombol Pratinjau di sebelahnya.
        Bedanya bukan kehati-hatian melainkan AKIBATNYA: yang satu tampil di layar
        orang yang menekannya, yang satu benar-benar sampai ke grup dan tidak bisa
        ditarik kembali. "Cuma uji kok" adalah persis anggapan yang membuat orang
        menekannya sebelum meninjau siapa saja yang ada di sana.
      */}
      <ConfirmDialog
        open={mengujiTerbuka}
        onClose={() => setMengujiTerbuka(false)}
        onConfirm={() => {
          setMengujiTerbuka(false);
          startUji(async () => setHasilUji(await kirimUjiBulananAction()));
        }}
        title="Kirim rekap uji"
        confirmLabel="Kirim sekarang"
        pendingLabel="Mengirim..."
        message={
          <>
            Seluruh tujuan yang mencentang <strong>&ldquo;Terima rekap bulanan&rdquo;</strong> akan menerima rekap{' '}
            <strong>bulan lalu</strong> &mdash; isinya sama persis dengan yang berangkat terjadwal, bukan kalimat
            contoh. Pesannya ditandai <em>[UJI COBA]</em> di baris pertama.
            <br />
            <br />
            Isinya angka, bukan data pasien. Tapi pesan WhatsApp yang sudah terkirim tidak bisa ditarik kembali, dan
            angka belanja serta omzet ikut di dalamnya &mdash; pastikan dulu siapa saja yang ada di tujuan itu.
          </>
        }
        pending={ujiPending}
      />
    </div>
  );
}
