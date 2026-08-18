'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  Button,
  Card,
  cardClassName,
  Callout,
  CheckboxList,
  Modal,
  MessageEditor,
  Petunjuk,
  Textarea,
} from '@/components/ui';
import type { JenisDokumen } from '@/core/dokumenDoc';
import {
  toggleDokumenAction,
  toggleRincianObatAction,
  simpanTeksDokumenAction,
  simpanCaraBayarDokumenAction,
  type HasilForm,
} from './actions';

const VARIABEL = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;

/**
 * Tab DOKUMEN HASIL (migrations/038).
 *
 * Yang ditawarkan di sini berbeda jenisnya dari dua tab surat di sebelahnya,
 * dan halaman ini harus MENGATAKANNYA. Surat keterangan sakit/sehat dikirim
 * staf yang menekan tombol untuk satu pasien yang sedang menunggu; yang ini
 * menempel pada pemberitahuan yang sudah berjalan otomatis, jadi begitu
 * sakelarnya menyala tidak ada lagi seorang pun yang melihat tiap berkas
 * sebelum berangkat.
 *
 * Karena itu setiap sakelar di bawah berdampingan dengan tombol pratinjau, dan
 * peringatannya TIDAK dilipat -- aturan yang sama seperti peringatan "pesan ini
 * berisi data pasien" di /farmasi: keterangan yang harus dibaca sebelum sebuah
 * sakelar dinyalakan tidak boleh disembunyikan demi halaman yang lebih pendek.
 */

const JUDUL: Record<JenisDokumen, string> = {
  lab: 'Hasil laboratorium',
  radiologi: 'Hasil radiologi',
  nota: 'Rincian tagihan (nota)',
};

const PEMICU: Record<JenisDokumen, { kode: string; nama: string }> = {
  lab: { kode: 'LAB_RESULT', nama: 'Hasil lab' },
  radiologi: { kode: 'RAD_RESULT', nama: 'Hasil radiologi' },
  nota: { kode: 'BILLING_READY', nama: 'Tagihan terbit' },
};

const ISI: Record<JenisDokumen, React.ReactNode> = {
  lab: (
    <>
      Nama parameter, <strong>angka hasilnya</strong>, satuan, nilai rujukan, dan keterangan — persis kolom yang
      dicetak Khanza di lembar loket. Ini data medis paling telanjang yang bisa keluar dari sistem ini.
    </>
  ),
  radiologi: (
    <>
      Nama pemeriksaan dan <strong>narasi bacaan dokter radiologi</strong> apa adanya. Karena bentuknya kalimat bebas,
      isinya tidak bisa dibatasi kolom per kolom seperti hasil lab — apa pun yang diketik dokter ikut terkirim.
    </>
  ),
  nota: (
    <>
      Daftar nama layanan dan obat berikut banyaknya — <strong>tanpa harga per item</strong>. Yang bernilai rupiah
      hanya subtotal tiap kelompok dan total tagihan, dan keduanya tetap menghitung seluruh item. Nama obat ikut,
      kecuali diringkas lewat sakelar di bawah.
    </>
  ),
};

function TombolPratinjau({ jenis, adaContoh }: { jenis: JenisDokumen; adaContoh: boolean }) {
  const [buka, setBuka] = useState(false);

  /**
   * Tombolnya ADA sekalipun Khanza belum pernah mencatat kejadian jenis ini.
   *
   * Sebelumnya yang tampil cuma kalimat "belum ada yang bisa dijadikan contoh",
   * dan itu keadaan NYATA untuk radiologi di rumah sakit ini. Akibatnya sakelar
   * yang mengirim berkas berisi narasi dokter ke pasien harus diputuskan tanpa
   * seorang pun pernah melihat bentuk berkasnya. Contohnya lalu memakai data
   * karangan -- dan halaman itu mengatakan dirinya karangan, di berkasnya
   * maupun di sini.
   */
  return (
    <>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setBuka(true)}>
        {adaContoh ? 'Lihat contoh berkas' : 'Lihat contoh berkas (data karangan)'}
      </Button>

      {!adaContoh && (
        <p className="mt-2 text-xs text-muted-foreground">
          Belum ada satu pun kejadian jenis ini di Khanza. Contohnya memakai <strong>data karangan</strong>: bentuk
          halamannya sama persis dengan yang akan terkirim, isinya bukan pasien mana pun.
        </p>
      )}

      <Modal open={buka} onClose={() => setBuka(false)} size="xl" title={`Contoh ${JUDUL[jenis].toLowerCase()}`}>
        <p className="mb-2 text-xs text-muted-foreground">
          {adaContoh ? (
            <>
              Contohnya diambil dari <strong>kejadian terbaru yang sungguhan</strong> di Khanza, bukan data karangan —
              itu satu-satunya cara memastikan bentuknya benar. Jangan dibiarkan terbuka di layar bersama.
            </>
          ) : (
            <>
              Belum ada kejadian jenis ini di Khanza, jadi isinya <strong>data karangan</strong> — bukan pasien, bukan
              hasil pemeriksaan, dan bukan tagihan siapa pun. Yang dibuktikannya bentuk halaman, bukan bentuk data.
            </>
          )}
        </p>
        {/* Lebar dipaku 794 px (A4 pada 96 dpi) dan digulir menyamping bila
            layar sempit. Membiarkannya melar mengikuti modal mengubah
            pemenggalan baris, sehingga yang dilihat staf bukan lagi susunan
            yang akan diterima pasien. */}
        <div className="overflow-x-auto rounded-md border">
          <iframe
            // `key` wajib: tanpa itu React memakai ulang elemen yang sama saat
            // jenisnya berganti, dan isinya sempat menampilkan dokumen
            // SEBELUMNYA sementara penanda "sudah dimuat" sudah bernilai benar.
            key={jenis}
            src={`/administrasi/pratinjau-dokumen?jenis=${jenis}`}
            title={`Pratinjau ${JUDUL[jenis]}`}
            sandbox=""
            className="h-[70vh] w-[794px] max-w-none bg-white"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/administrasi/pratinjau-dokumen?jenis=${jenis}&format=pdf`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            Buka berkas PDF
          </a>
          <span className="text-xs text-muted-foreground">
            (yang ini bisa saja diunduh alih-alih ditampilkan — itu setelan peramban, bukan sistem ini)
          </span>
        </div>
      </Modal>
    </>
  );
}

/**
 * Penyaring CARA BAYAR untuk satu jenis lampiran (migrations/048).
 *
 * Dilipat lewat `<details>` asli dan TERTUTUP secara bawaan, berbeda dari
 * peringatan di atasnya yang sengaja terbentang. Bedanya mengikuti aturan empat
 * tingkat prosa: peringatan itu PAGAR -- harus dibaca sebelum sakelarnya
 * dinyalakan; yang ini penyetelan lanjutan yang keadaan bawaannya sudah benar
 * untuk sebagian besar rumah sakit.
 *
 * Judulnya karena itu WAJIB memuat keadaan yang sedang berlaku, bukan cuma nama
 * setelannya: `<summary>` adalah satu-satunya bagian yang selalu terlihat, dan
 * penyaring aktif yang tersembunyi di balik kata "Penyaring cara bayar" adalah
 * persis bentuk yang membuat "kenapa pasien ini tidak dapat berkasnya" tidak
 * terjawab dari layar.
 */
function PenyaringCaraBayar({
  jenis,
  opsi,
  terpilih,
}: {
  jenis: JenisDokumen;
  opsi: { kode: string; nama: string }[];
  terpilih: string[];
}) {
  const [hasil, aksi, pending] = useActionState(simpanCaraBayarDokumenAction, {} as HasilForm);
  const aktifkanPenyaring = terpilih.length > 0;

  return (
    <details className="mt-3 rounded-md border border-border/60 p-3" open={aktifkanPenyaring}>
      <summary className="cursor-pointer list-item text-sm font-medium">
        Cara bayar{' '}
        <span className="font-normal text-muted-foreground">
          {aktifkanPenyaring
            ? `— dibatasi ${terpilih.length} penjamin`
            : '— semua penjamin (tidak dibatasi)'}
        </span>
      </summary>

      <form action={aksi} className="mt-3">
        <input type="hidden" name="jenis" value={jenis} />

        <p className="mb-2 flex items-start gap-1 text-xs text-muted-foreground">
          <span>
            Kosongkan semua = lampiran dikirim untuk <span className="font-medium text-foreground">seluruh</span> cara
            bayar. Yang tersaring <span className="font-medium text-foreground">tetap menerima pesannya</span>, cuma
            tanpa berkas.
          </span>
          <Petunjuk untuk={`Penyaring cara bayar ${JUDUL[jenis]}`}>
            Ini penyaring <span className="font-medium text-foreground">LAMPIRAN</span>, bukan penyaring
            pemberitahuan. Pasien yang penjaminnya di luar daftar tetap menerima kabar bahwa hasil/tagihannya sudah
            terbit — kalimat yang memang sudah berdiri sendiri sejak sebelum fitur lampiran ada.
            <br />
            <br />
            Daftar di bawah memuat <span className="font-medium text-foreground">seluruh</span> penjamin di Khanza,
            termasuk yang sudah dinonaktifkan. Itu disengaja: penyaringnya dicocokkan terhadap kunjungan yang SUDAH
            terjadi, jadi asuransi yang dinonaktifkan bulan lalu tetap penjamin kunjungan bulan lalu.
            <br />
            <br />
            Kunjungan yang penjaminnya <span className="font-medium text-foreground">belum diisi</span> petugas tidak
            akan pernah lolos begitu penyaring ini dipasang — penanda kosong Khanza tidak ada di daftar pilihan.
            Terukur 2 dari 1.900 nota dalam 90 hari.
          </Petunjuk>
        </p>

        <CheckboxList
          name="cara_bayar"
          options={opsi}
          defaultSelected={terpilih}
          searchPlaceholder="Cari penjamin..."
        />

        {hasil.sukses && <p className="mt-2 text-xs text-success">{hasil.sukses}</p>}
        {hasil.error && <p className="mt-2 text-xs text-destructive">{hasil.error}</p>}

        <Button type="submit" variant="secondary" size="sm" className="mt-3" disabled={pending}>
          {pending ? 'Menyimpan...' : 'Simpan penyaring'}
        </Button>
      </form>
    </details>
  );
}

export function DokumenSwitch({
  jenis,
  aktif,
  pemicuAktif,
  adaContoh,
  opsiCaraBayar,
  caraBayarTerpilih,
}: {
  jenis: JenisDokumen;
  aktif: boolean;
  /** `template.is_active` pemicunya -- yang sebenarnya menahan seluruhnya. */
  pemicuAktif: boolean;
  adaContoh: boolean;
  opsiCaraBayar: { kode: string; nama: string }[];
  caraBayarTerpilih: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm | null>(null);
  const p = PEMICU[jenis];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-title">{JUDUL[jenis]}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{ISI[jenis]}</p>
        </div>
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          disabled={pending}
          onClick={() => startTransition(async () => setPesan(await toggleDokumenAction(jenis, !aktif)))}
        >
          {pending ? 'Menyimpan...' : aktif ? 'Matikan' : 'Nyalakan'}
        </Button>
      </div>

      {pesan?.sukses && <p className="mt-3 text-sm text-success">{pesan.sukses}</p>}
      {pesan?.error && <p className="mt-3 text-sm text-destructive">{pesan.error}</p>}

      {/**
       * Keadaan "menyala tapi tidak menghasilkan apa-apa" bergejala persis sama
       * dengan yang benar: halaman tampak wajar, nol berkas keluar. Yang
       * membedakannya cuma `template.is_active` pemicunya, dan itu diatur di
       * halaman LAIN -- jadi harus disebut di sini, bukan ditunggu sampai ada
       * yang bertanya kenapa tidak ada berkas yang terkirim.
       */}
      {aktif && !pemicuAktif && (
        <Callout variant="warning" className="mt-3" title={`Pemicu "${p.nama}" masih nonaktif`}>
          Lampiran ini menempel pada pemberitahuan <code>{p.kode}</code>, dan pemicu itu sedang mati — jadi{' '}
          <strong>tidak ada pesan yang keluar sama sekali</strong>, dengan atau tanpa berkas. Nyalakan di{' '}
          <a href="/template" className="underline">
            halaman Template
          </a>
          .
        </Callout>
      )}

      <TombolPratinjau jenis={jenis} adaContoh={adaContoh} />

      {/* Ditaruh DI DALAM Card yang sama, bukan sebagai kartu tersendiri:
          penyaring ini melayani satu jenis dokumen, dan menaruhnya terpisah
          membuat pasangannya harus diingat alih-alih terlihat. */}
      <PenyaringCaraBayar jenis={jenis} opsi={opsiCaraBayar} terpilih={caraBayarTerpilih} />
    </Card>
  );
}

export function RincianObatSwitch({ aktif, notaAktif }: { aktif: boolean; notaAktif: boolean }) {
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm | null>(null);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-1 text-title">
            Nama obat pada nota
            <Petunjuk untuk="Nama obat pada nota">
              Saat dimatikan, baris obat diringkas jadi satu <span className="font-medium text-foreground">Subtotal</span>.
              Angkanya tetap terhitung penuh dan totalnya tetap sama — yang disembunyikan hanya namanya, dan notanya
              mengatakan bahwa rinciannya sengaja tidak dicantumkan.
            </Petunjuk>
          </h2>
        </div>
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          disabled={pending || !notaAktif}
          onClick={() => startTransition(async () => setPesan(await toggleRincianObatAction(!aktif)))}
        >
          {pending ? 'Menyimpan...' : aktif ? 'Ringkas saja' : 'Tampilkan nama obat'}
        </Button>
      </div>

      {!notaAktif && (
        <p className="mt-3 text-xs text-muted-foreground">
          Berlaku hanya bila lampiran <strong>Rincian tagihan</strong> di atas dinyalakan.
        </p>
      )}
      {pesan?.sukses && <p className="mt-3 text-sm text-success">{pesan.sukses}</p>}
      {pesan?.error && <p className="mt-3 text-sm text-destructive">{pesan.error}</p>}
    </Card>
  );
}

export function TeksDokumenForm({
  pesanLab,
  pesanRad,
  pesanNota,
  catatanKaki,
}: {
  pesanLab: string;
  pesanRad: string;
  pesanNota: string;
  catatanKaki: string;
}) {
  const [state, formAction, pending] = useActionState(simpanTeksDokumenAction, {} as HasilForm);
  const [lab, setLab] = useState(pesanLab);
  const [rad, setRad] = useState(pesanRad);
  const [nota, setNota] = useState(pesanNota);

  return (
    <form action={formAction} className={`space-y-4 ${cardClassName}`}>
      <div>
        <h2 className="flex items-center gap-1 text-title">
          Pesan pengantar &amp; catatan kaki
          <Petunjuk untuk="Pesan pengantar dan catatan kaki">
            <p>
              Pesan ini <span className="font-medium text-foreground">menggantikan</span> teks template pemicunya, dan
              hanya saat berkasnya benar-benar ikut. Kalau lampirannya gagal dibuat, pesan yang terkirim tetap teks
              template biasa — jadi kalimat &ldquo;silakan ambil di loket&rdquo; di sana masih tetap benar dan sengaja
              dibiarkan.
            </p>
            <p className="mt-2">
              Pesan berlampiran dibatasi 1.024 karakter oleh WhatsApp, termasuk baris kode pengiriman yang ditambahkan
              otomatis. Yang melebihi ditolak saat disimpan, bukan saat kirim.
            </p>
          </Petunjuk>
        </h2>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Pesan hasil laboratorium</label>
        <MessageEditor name="pesan_lab" value={lab} onValueChange={setLab} variables={VARIABEL} rows={4} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Pesan hasil radiologi</label>
        <MessageEditor name="pesan_rad" value={rad} onValueChange={setRad} variables={VARIABEL} rows={4} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Pesan rincian tagihan</label>
        <MessageEditor name="pesan_nota" value={nota} onValueChange={setNota} variables={VARIABEL} rows={4} />
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <label className="text-sm font-medium" htmlFor="catatan_kaki_dokumen">
            Catatan kaki di dalam berkas
          </label>
          <Petunjuk untuk="Catatan kaki di dalam berkas">
            Dicetak kecil di kaki dokumen, di bawah tanda tangan. Dikosongkan = memakai kalimat bawaan; ia tidak bisa
            dihilangkan sama sekali, karena berkas yang beredar lepas harus tetap menyebut asalnya.{' '}
            <span className="font-mono">{'{nama_rs}'}</span> dan <span className="font-mono">{'{kontak_rs}'}</span>{' '}
            diganti otomatis.
          </Petunjuk>
        </div>
        <Textarea id="catatan_kaki_dokumen" name="catatan_kaki_dokumen" defaultValue={catatanKaki} rows={3} className="w-full" />
      </div>

      {state?.sukses && <p className="text-sm text-success">{state.sukses}</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan teks dokumen'}
      </Button>
    </form>
  );
}
