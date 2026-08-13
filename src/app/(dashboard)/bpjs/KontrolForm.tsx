'use client';

import { useActionState, useState, useTransition } from 'react';
import { BPJS_KONTROL_TEMPLATE_VARIABLES } from '@/core/template';
import { Button, Input, MessageEditor, Card } from '@/components/ui';
import { bacaHariSebelum, labelSisaHari, MAX_HARI_SEBELUM } from '@/core/bpjs';
import { simpanKontrolAction, jalankanKontrolSekarangAction, type HasilForm } from './actions';

export interface NilaiKontrol {
  hariSebelum: string;
  jam: number;
  kePasien: boolean;
  template: string;
  templateGeneric: string;
  /** Kapan terakhir jalan (sudah diformat server), null = belum pernah. */
  terakhirJalan: string | null;
}

export function KontrolForm({ nilai }: { nilai: NilaiKontrol }) {
  const [state, formAction, isPending] = useActionState(simpanKontrolAction, {} as HasilForm);
  const [hari, setHari] = useState(nilai.hariSebelum);
  const [jam, setJam] = useState(String(nilai.jam));
  const [hasilJalan, setHasilJalan] = useState<HasilForm>({});
  const [jalanPending, startJalan] = useTransition();

  /**
   * Pratinjau memakai `bacaHariSebelum` yang SAMA dipakai worker dan server
   * action -- bukan pembacaan sendiri di sisi klien.
   *
   * Pratinjau yang menafsirkan isian berbeda dari yang benar-benar dijalankan
   * lebih buruk daripada tanpa pratinjau: staf mengetik "7, besok" lalu membaca
   * konfirmasi yang menyebut dua pengingat, sementara mesinnya cuma mengenali
   * satu. Karena fungsinya murni (tanpa database), memakainya di sini gratis.
   */
  const daftar = bacaHariSebelum(hari);
  const jamAngka = Number(jam);
  const jamSah = Number.isInteger(jamAngka) && jamAngka >= 0 && jamAngka <= 23;

  return (
    <>
      <form action={formAction} className="space-y-4">
        <Card>
          <h3 className="text-title-sm">Kapan diingatkan</h3>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="block max-w-56 grow space-y-1">
              <span className="block text-xs font-medium">Berapa hari sebelum tanggal kontrol</span>
              <Input
                name="bpjs.kontrol_hari_sebelum"
                value={hari}
                onChange={(e) => setHari(e.target.value)}
                placeholder="7,1"
                fieldSize="sm"
                className="w-full"
              />
              <span className="block text-xs text-muted-foreground">
                Pisahkan dengan koma untuk lebih dari satu pengingat. <span className="font-mono">0</span> berarti hari-H
                itu sendiri. Maksimal {MAX_HARI_SEBELUM}, dan maksimal 5 pengingat.
              </span>
            </label>

            <label className="block max-w-40 space-y-1">
              <span className="block text-xs font-medium">Jam kirim</span>
              <Input
                name="bpjs.kontrol_jam"
                type="number"
                min={0}
                max={23}
                value={jam}
                onChange={(e) => setJam(e.target.value)}
                fieldSize="sm"
                className="w-full"
              />
              <span className="block text-xs text-muted-foreground">
                Jam dinding WIB. Berlaku hari itu juga — tidak perlu menyalakan ulang apa pun.
              </span>
            </label>
          </div>

          {/* Isian yang tidak terbaca harus TERLIHAT tidak terbaca. Tanpa ini,
              "7, besok" tampak tersimpan utuh dan pengingat keduanya sekadar
              tidak pernah datang. */}
          <p className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
            {daftar.length === 0 ? (
              <span className="text-destructive">
                Belum ada angka yang terbaca — pengingatnya tidak akan pernah terkirim. Isi mis.{' '}
                <span className="font-mono">7,1</span>.
              </span>
            ) : (
              <>
                Untuk satu surat kontrol,{' '}
                <span className="font-medium text-foreground">
                  {daftar.length} pengingat{daftar.length > 1 ? '' : ''}
                </span>{' '}
                akan dikirim pukul {jamSah ? `${jamAngka}:00` : '—'}:{' '}
                {daftar.map((n, i) => (
                  <span key={n}>
                    {i > 0 ? ', ' : ''}
                    <span className="font-medium text-foreground">{labelSisaHari(n)}</span>
                    {n > 0 ? ` (H-${n})` : ''}
                  </span>
                ))}
                .
              </>
            )}
          </p>

          <label className="mt-3 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="bpjs.kontrol_ke_pasien"
              defaultChecked={nilai.kePasien}
              className="accent-primary"
            />
            Kirim ke pasien
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            Matikan bila rumah sakit belum memutuskan pengingat boleh dikirim ke pasien — pengingatnya lalu hanya masuk
            ke tujuan yang mencentang “Terima salinan kontrol”. Tidak bisa dimatikan selama belum ada tujuan seperti itu,
            karena pesannya tidak akan pergi ke mana pun.
          </p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-title-sm">Isi pengingat</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{'{sisa_hari}'}</span> sudah berbentuk kalimat (“besok”, “7 hari lagi”), bukan
              angka. <span className="font-mono">{'{nama_poli}'}</span> dan{' '}
              <span className="font-mono">{'{nama_dokter}'}</span> diambil dari surat kontrolnya sendiri — nama yang
              tercetak di kertas yang dipegang pasien.
            </p>
            <div className="mt-3">
              <MessageEditor
                name="bpjs.template_kontrol"
                defaultValue={nilai.template}
                variables={BPJS_KONTROL_TEMPLATE_VARIABLES}
                rows={8}
              />
            </div>
          </Card>

          <Card>
            <h3 className="text-title-sm">Pesan untuk poli sensitif</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Boleh <span className="font-medium text-foreground">dikosongkan</span> — bila kosong, yang dipakai adalah
              pesan generik di halaman Pengaturan, sama seperti notifikasi pasien lainnya. Isi di sini hanya bila kanal
              BPJS perlu bunyi yang berbeda.
            </p>
            <div className="mt-3">
              <MessageEditor
                name="bpjs.template_kontrol_generic"
                defaultValue={nilai.templateGeneric}
                variables={BPJS_KONTROL_TEMPLATE_VARIABLES}
                rows={5}
              />
            </div>
          </Card>
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.sukses && <p className="text-sm text-success">{state.sukses}</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? 'Menyimpan...' : 'Simpan pengaturan pengingat'}
          </Button>
        </div>
      </form>

      {/* Di LUAR form di atas: menekannya tidak boleh ikut mengirimkan form,
          dan sebaliknya menyimpan pengaturan tidak boleh ikut menjalankan. */}
      <Card className="mt-4">
        <h3 className="text-title-sm">Jalankan sekarang</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Jadwal harian punya masa tunggu yang panjang: setelan yang baru diubah tidak bisa dibuktikan sampai besok pada
          jam kirimnya. Tombol ini menjalankan pekerjaan yang{' '}
          <span className="font-medium text-foreground">sama persis</span> dengan yang dijalankan otomatis, memakai
          setelan yang <span className="font-medium text-foreground">sudah tersimpan</span>. Aman ditekan berulang —
          satu surat tidak akan diingatkan dua kali untuk selisih hari yang sama, dan jadwal hari ini tidak ikut
          dianggap sudah jalan.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Terakhir dijalankan otomatis:{' '}
          <span className="font-medium text-foreground">{nilai.terakhirJalan ?? 'belum pernah'}</span>
        </p>
        {hasilJalan.error && <p className="mt-2 text-sm text-destructive">{hasilJalan.error}</p>}
        {hasilJalan.sukses && <p className="mt-2 text-sm text-success">{hasilJalan.sukses}</p>}
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={jalanPending}
            onClick={() => startJalan(async () => setHasilJalan(await jalankanKontrolSekarangAction()))}
          >
            {jalanPending ? 'Menjalankan...' : 'Jalankan sekarang'}
          </Button>
        </div>
      </Card>
    </>
  );
}
