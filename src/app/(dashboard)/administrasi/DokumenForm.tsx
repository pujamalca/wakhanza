'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button, Card, cardClassName, Callout, Modal, MessageEditor, Textarea } from '@/components/ui';
import type { JenisDokumen } from '@/core/dokumenDoc';
import { toggleDokumenAction, toggleRincianObatAction, simpanTeksDokumenAction, type HasilForm } from './actions';

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
      Daftar rinci layanan berikut tarif, jumlah, subtotal per kelompok, dan totalnya. Termasuk{' '}
      <strong>nama obat</strong>, kecuali diringkas lewat sakelar di bawah.
    </>
  ),
};

function TombolPratinjau({ jenis, adaContoh }: { jenis: JenisDokumen; adaContoh: boolean }) {
  const [buka, setBuka] = useState(false);

  if (!adaContoh) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Belum ada kejadian jenis ini di Khanza, jadi belum ada yang bisa dijadikan contoh pratinjau.
      </p>
    );
  }

  return (
    <>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setBuka(true)}>
        Lihat contoh berkas
      </Button>

      <Modal open={buka} onClose={() => setBuka(false)} size="xl" title={`Contoh ${JUDUL[jenis].toLowerCase()}`}>
        <p className="mb-2 text-xs text-muted-foreground">
          Contohnya diambil dari <strong>kejadian terbaru yang sungguhan</strong> di Khanza, bukan data karangan — itu
          satu-satunya cara memastikan bentuknya benar. Jangan dibiarkan terbuka di layar bersama.
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

export function DokumenSwitch({
  jenis,
  aktif,
  pemicuAktif,
  adaContoh,
}: {
  jenis: JenisDokumen;
  aktif: boolean;
  /** `template.is_active` pemicunya -- yang sebenarnya menahan seluruhnya. */
  pemicuAktif: boolean;
  adaContoh: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [pesan, setPesan] = useState<HasilForm | null>(null);
  const p = PEMICU[jenis];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="font-medium">{JUDUL[jenis]}</h2>
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
          <h2 className="font-medium">Nama obat pada nota</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saat dimatikan, baris obat diringkas jadi satu <strong>Subtotal</strong>. Angkanya tetap terhitung penuh dan
            totalnya tetap sama — yang disembunyikan hanya namanya, dan notanya mengatakan bahwa rinciannya sengaja
            tidak dicantumkan.
          </p>
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
        <h2 className="font-medium">Pesan pengantar &amp; catatan kaki</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pesan ini <strong>menggantikan</strong> teks template pemicunya, dan hanya saat berkasnya benar-benar ikut.
          Kalau lampirannya gagal dibuat, pesan yang terkirim tetap teks template biasa — jadi kalimat &ldquo;silakan
          ambil di loket&rdquo; di sana masih tetap benar dan sengaja dibiarkan.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pesan berlampiran dibatasi 1.024 karakter oleh WhatsApp, termasuk baris kode pengiriman yang ditambahkan
          otomatis. Yang melebihi ditolak saat disimpan, bukan saat kirim.
        </p>
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
        <label className="text-sm font-medium" htmlFor="catatan_kaki_dokumen">
          Catatan kaki di dalam berkas
        </label>
        <p className="text-xs text-muted-foreground">
          Dicetak kecil di kaki dokumen, di bawah tanda tangan. Dikosongkan = memakai kalimat bawaan; ia tidak bisa
          dihilangkan sama sekali, karena berkas yang beredar lepas harus tetap menyebut asalnya.{' '}
          <span className="font-mono">{'{nama_rs}'}</span> dan <span className="font-mono">{'{kontak_rs}'}</span>{' '}
          diganti otomatis.
        </p>
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
