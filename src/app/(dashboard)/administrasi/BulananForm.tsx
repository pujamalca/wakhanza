'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button, ConfirmDialog, Input, MessageEditor, Petunjuk } from '@/components/ui';
import { REKAP_ADM_BULANAN_TEMPLATE_VARIABLES } from '@/core/template';
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
 * Bagian terpenting form ini, bukan hiasan: "tanggal 3" tidak memberi tahu siapa
 * pun bahwa yang datang tanggal 3 Januari adalah rekap Desember. Contohnya
 * DIHITUNG dari hari ini alih-alih ditulis mati, supaya perilaku pergantian tahun
 * terlihat sendiri tanpa perlu dijelaskan.
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
          Tanggal 1 berarti rekapnya berangkat pada hari pertama bulan baru. Kunjungan akhir bulan yang baru di-closing
          hari kerja berikutnya akan <span className="font-medium text-foreground">terhitung sebagai belum bayar</span>{' '}
          padahal kasirnya belum sempat buka &mdash; pilih tanggal 3&ndash;5 kalau closing sering menyusul.
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
          yang mencentang <span className="font-medium">&ldquo;Terima rekap bulanan&rdquo;</span> di daftar tujuan di
          atas &mdash; centang itu <span className="font-medium">terpisah</span> dari kolom Status.
        </div>
      )}

      <form action={simpanAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="text-xs font-medium">Tanggal kirim</label>
              <Petunjuk untuk="Tanggal kirim rekap bulanan">
                Tanggal berapa dalam bulan rekapnya dikirim. Bawaannya{' '}
                <span className="font-medium text-foreground">3</span>, bukan 1: kunjungan akhir bulan kadang baru
                di-closing hari kerja pertama bulan berikutnya, dan rekap tanggal 1 akan menghitungnya sebagai
                &ldquo;belum closing billing&rdquo; padahal kasirnya belum sempat buka.
                <br />
                <br />
                Dibatasi <span className="font-medium text-foreground">1&ndash;28</span> karena Februari tidak punya
                tanggal 29&ndash;31 &mdash; jadwal &ldquo;tiap tanggal 30&rdquo; akan melewatkan satu bulan setiap tahun
                tanpa satu pun galat.
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
                Bawaannya <span className="font-medium text-foreground">08.00</span> &mdash; pagi hari kerja. Periodenya
                sudah tutup berhari-hari, jadi satu-satunya yang menentukan adalah kapan orang membacanya.
                <br />
                <br />
                Jam berapa pun boleh, termasuk yang jatuh di dalam jam tenang: rekap ini sengaja dikecualikan dari jam
                tenang justru karena jadwalnya dipilih staf sendiri.
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
            <Petunjuk untuk="Isi pesan rekap bulanan administrasi">
              Variabelnya <span className="font-medium text-foreground">berbeda</span> dari rekap bulanan apotek: yang
              itu menghitung pasien yang DIRESEPKAN, yang ini menghitung SELURUH pasien yang datang.
              <br />
              <br />
              Yang tidak tersedia, dan ketiadaannya disengaja: {'{nama_pasien}'}, {'{no_rm}'}, {'{nama_poli}'},{' '}
              {'{nama_dokter}'}, dan seluruh isi asesmen/SOAPIE/resume. Rekap ini seluruhnya angka &mdash; kelengkapan
              berkas dibaca lewat ada-tidaknya barisnya, tidak pernah isinya.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_bulanan"
            defaultValue={nilai.template}
            variables={REKAP_ADM_BULANAN_TEMPLATE_VARIABLES}
            rows={18}
            disabled={simpanPending}
            hint="{rincian_pasien}, {rincian_cara_bayar}, dan {rincian_berkas} dirakit sistem — masing-masing beberapa baris siap pakai."
          />

          {/* Tiga hal yang paling mudah disalahpahami, dan ketiganya bisa membuat
              angka yang dilaporkan ke manajemen meleset tanpa ada yang
              menyadarinya. */}
          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{'{jumlah_pasien}'}</span> dan{' '}
              <span className="font-medium text-foreground">{'{jumlah_kunjungan}'}</span> BUKAN angka yang sama.
            </span>
            <Petunjuk untuk="Pasien versus kunjungan">
              <span className="font-medium text-foreground">Kunjungan</span> menghitung berapa kali pendaftaran terjadi;{' '}
              <span className="font-medium text-foreground">pasien</span> menghitung berapa ORANG berbeda. Pasien yang
              berobat tiga kali sebulan terhitung tiga kunjungan tapi satu pasien.
              <br />
              <br />
              Selisihnya nyata: pada Juli 2026 terukur{' '}
              <span className="font-medium text-foreground">668 kunjungan dari 563 pasien</span> &mdash; beda 16%.
              Memakai yang satu dengan label yang satunya berarti angka laporan meleset sebanyak itu setiap bulan, tanpa
              satu pun galat.
            </Petunjuk>
          </p>

          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">Pasien lama</span> dan{' '}
              <span className="font-medium text-foreground">pasien berulang</span> juga bukan angka yang sama.
            </span>
            <Petunjuk untuk="Pasien lama versus pasien berulang">
              <span className="font-medium text-foreground">Pasien lama</span> adalah orang yang pernah ke poli ini
              SEBELUMNYA &mdash; bisa saja setahun lalu, dan cuma datang sekali bulan ini.{' '}
              <span className="font-medium text-foreground">Pasien berulang</span> adalah orang yang bolak-balik DI
              DALAM bulan yang direkap.
              <br />
              <br />
              Terukur pada Juli 2026: 477 kunjungan pasien lama, sementara yang berulang cuma{' '}
              <span className="font-medium text-foreground">81 orang</span> yang menyumbang 186 kunjungan. Keduanya
              disebut berdampingan di {'{rincian_pasien}'} justru karena gampang tertukar.
            </Petunjuk>
          </p>

          <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground">
            <span>
              Diagnosa, resume, dan surat kontrol akan berbunyi{' '}
              <span className="font-medium text-foreground">0 atau nyaris 0</span> di sini.
            </span>
            <Petunjuk untuk="Kenapa beberapa angka selalu nol">
              Terukur di database produksi:{' '}
              <span className="font-medium text-foreground">diagnosa terisi pada 3 dari 668 kunjungan</span> (0,4%) pada
              Juli 2026 dan tidak pernah melewati 6% pada bulan mana pun;{' '}
              <span className="font-medium text-foreground">resume_pasien nol baris</span> seluruhnya;{' '}
              <span className="font-medium text-foreground">surat kontrol</span> satu baris, dan{' '}
              <span className="font-medium text-foreground">surat sakit</span> berhenti dicatat sejak Februari 2025.
              <br />
              <br />
              Ketiganya tetap ditampilkan dan bukan disembunyikan: nol di sini bukan sifat struktural melainkan keadaan
              yang bisa berubah, dan hari petugas mulai mengisinya adalah hari angkanya mulai berarti. Disembunyikan,
              &ldquo;tidak ada resume&rdquo; tidak bisa dibedakan dari &ldquo;fiturnya tidak membaca resume&rdquo;.
            </Petunjuk>
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label className="text-xs font-medium">
              Isi pesan saat bulan itu tanpa satu pun kunjungan{' '}
              <span className="text-muted-foreground">(opsional)</span>
            </label>
            <Petunjuk untuk="Isi pesan saat bulan kosong">
              Dipakai HANYA bila bulan itu nol kunjungan &mdash; artinya rumah sakit tidak menerima seorang pasien pun
              sebulan penuh.
              <br />
              <br />
              Mengisinya masuk akal justru karena keadaan seaneh itu tidak akan pernah jadi kebisingan. Dan kalau
              pesannya datang tanpa ada yang menutup rumah sakit, yang sedang ia laporkan adalah query yang berhenti
              membaca.
            </Petunjuk>
          </div>
          <MessageEditor
            name="template_bulanan_kosong"
            defaultValue={nilai.templateKosong}
            variables={REKAP_ADM_BULANAN_TEMPLATE_VARIABLES}
            rows={4}
            disabled={simpanPending}
            hint="Dibiarkan kosong = sistem DIAM pada bulan tanpa satu pun kunjungan."
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
            <span className="font-medium text-foreground">Kirim rekap uji</span> benar-benar mengirimnya ke seluruh
            tujuan &mdash; itu satu-satunya cara membuktikan pesannya TIBA, karena kiriman ke kode grup yang salah pun
            tetap tercatat berhasil.
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

        {/* Bulan tanpa kunjungan + pesan kosong yang sengaja diam. Dikatakan
            eksplisit: pratinjau yang tidak menampilkan apa pun terbaca sebagai
            fitur rusak, padahal itu justru perilaku yang diminta. */}
        {pratinjau.diam && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tidak ada satu pun kunjungan tercatat pada{' '}
            <span className="font-medium text-foreground">{pratinjau.bulan}</span>, dan isi pesan saat bulan kosong
            dibiarkan kosong &mdash; jadi pada bulan seperti ini sistem sengaja tidak mengirim apa pun. Kalau bulan itu
            seharusnya berisi, yang perlu diperiksa bukan pesannya melainkan kenapa query-nya tidak membaca apa-apa.
          </p>
        )}

        {pratinjau.teks && (
          <div className="mt-3">
            {/* Bulannya WAJIB disebut. Rekap yang isinya mengejutkan tidak bisa
                dibedakan dari query yang salah tanpa tahu periode mana yang dibaca. */}
            <p className="mb-1 text-xs text-muted-foreground">
              Periode <span className="font-medium text-foreground">{pratinjau.bulan}</span> &mdash;{' '}
              {pratinjau.jumlahKunjungan} kunjungan.
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
        ditarik kembali.
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
            angka kelengkapan berkas serta closing billing ikut di dalamnya &mdash; pastikan dulu siapa saja yang ada di
            tujuan itu.
          </>
        }
        pending={ujiPending}
      />
    </div>
  );
}
