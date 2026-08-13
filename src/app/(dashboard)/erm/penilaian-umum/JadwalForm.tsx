'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button, Input, Select, Callout, MessageEditor, Petunjuk } from '@/components/ui';
import { REKAP_PENILAIAN_TEMPLATE_VARIABLES } from '@/core/template';
import { bacaSlotRekap, tulisJamRekap } from '@/core/rekapJadwal';
import { simpanPenilaianAction, pratinjauAction, type HasilForm } from './actions';

export interface NilaiJadwal {
  jam: string;
  offset: number;
  maxBaris: number;
  rincian: 'penuh' | 'ringkas';
  poli: string;
  kolomInti: string[];
  body: string;
  bodyKosong: string;
}

/** Kolom vital yang boleh dipilih, berikut namanya yang bisa dibaca orang. */
const KOLOM: { nilai: string; label: string; catatan?: string }[] = [
  { nilai: 'td', label: 'Tekanan darah' },
  { nilai: 'nadi', label: 'Nadi' },
  { nilai: 'suhu', label: 'Suhu' },
  { nilai: 'rr', label: 'Pernapasan' },
  { nilai: 'gcs', label: 'GCS' },
  { nilai: 'keluhan_utama', label: 'Keluhan utama', catatan: 'praktis selalu terisi' },
  { nilai: 'bb', label: 'Berat badan', catatan: '75% kosong' },
  { nilai: 'tb', label: 'Tinggi badan', catatan: '91% kosong' },
];

export function JadwalForm({ nilai }: { nilai: NilaiJadwal }) {
  const [hasil, aksi] = useActionState(simpanPenilaianAction, {} as HasilForm);
  const [jam, setJam] = useState(nilai.jam);
  const [offset, setOffset] = useState(String(nilai.offset));
  const [rincian, setRincian] = useState(nilai.rincian);
  const [kolom, setKolom] = useState<string[]>(nilai.kolomInti);
  const [pratinjau, setPratinjau] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const slots = bacaSlotRekap(jam);
  const offsetNum = Number(offset);

  /**
   * Dua setelan yang bisa saling bertentangan WAJIB dibacakan AKIBATNYA, bukan
   * cuma ditampilkan angkanya.
   *
   * "13:00,19:30" + offset 0 dan "07:00" + offset 0 terlihat sama wajarnya di
   * layar, tapi yang kedua merekap hari yang belum dimulai. Kalimat penuh yang
   * berubah saat diketik menutup jarak itu -- pola yang sama dipakai rekap
   * penjualan (041).
   */
  const kalimat =
    slots.length === 0
      ? null
      : `Setiap hari pukul ${slots.map(tulisJamRekap).join(' dan ')}, sistem mengirim rekap pasien baru ` +
        (offsetNum === 0 ? 'HARI ITU JUGA.' : offsetNum === 1 ? 'KEMARIN.' : `${offsetNum} HARI SEBELUMNYA.`);

  // Jam pagi + offset 0 berarti merekap hari yang baru saja mulai.
  const pagiTanpaOffset = offsetNum === 0 && slots.length > 0 && slots.every((s) => s.jam < 10);

  return (
    <form action={aksi} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="jam" className="block text-label">
              Jam kirim
            </label>
            <Petunjuk untuk="cara menulis jam kirim">
              Boleh lebih dari satu, pisahkan dengan koma. Bawaannya{' '}
              <strong>13:00,19:30</strong> — yang pertama pengingat di tengah hari, yang kedua
              hitungan akhir setelah pengisian asesmen praktis berhenti (terukur: memuncak pukul
              18–19, nol sesudah pukul 20).
            </Petunjuk>
          </div>
          <Input
            id="jam"
            name="jam"
            fieldSize="md"
            value={jam}
            onChange={(e) => setJam(e.currentTarget.value)}
            placeholder="13:00,19:30"
          />
          {jam.trim() && slots.length === 0 && (
            <p className="mt-1 text-caption text-destructive">
              Tidak ada jam yang terbaca. Bentuknya HH:MM, mis. 13:00,19:30
            </p>
          )}
        </div>

        <div>
          <label htmlFor="offset" className="mb-1 block text-label">
            Hari yang direkap
          </label>
          <Select
            id="offset"
            name="offset"
            fieldSize="md"
            value={offset}
            onChange={(e) => setOffset(e.currentTarget.value)}
          >
            <option value="0">Hari ini juga</option>
            <option value="1">Kemarin</option>
          </Select>
        </div>
      </div>

      {kalimat && (
        <p className="measure text-prose text-muted-foreground">
          {kalimat}
        </p>
      )}

      {pagiTanpaOffset && (
        <Callout variant="warning" title="Jam pagi merekap hari yang baru saja dimulai">
          <p>
            Pada jam itu hampir semua pasien hari ini belum terdaftar, jadi rekapnya akan nyaris
            kosong setiap hari. Kalau yang dimaksud adalah rekap hari sebelumnya, setel{' '}
            <strong>Hari yang direkap</strong> ke &quot;Kemarin&quot;.
          </p>
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="rincian" className="block text-label">
              Tingkat rincian
            </label>
            <Petunjuk untuk="arti tingkat rincian">
              <strong>Penuh</strong> menyebut nama pasien dan nomor rekam medisnya — itu yang membuat
              rekapnya bisa ditindaklanjuti. <strong>Ringkas</strong> hanya angka, untuk rumah sakit
              yang memutuskan nama pasien tidak boleh beredar di grup.
            </Petunjuk>
          </div>
          <Select
            id="rincian"
            name="rincian"
            fieldSize="md"
            value={rincian}
            onChange={(e) => setRincian(e.currentTarget.value as 'penuh' | 'ringkas')}
          >
            <option value="penuh">Penuh — nama + no. RM</option>
            <option value="ringkas">Ringkas — angka saja</option>
          </Select>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="maxBaris" className="block text-label">
              Batas nama per pesan
            </label>
            <Petunjuk untuk="arti batas nama per pesan">
              0 berarti tanpa batas. Sisanya diringkas jadi &quot;dan N pasien lain&quot;, tidak
              pernah dibuang diam-diam. Pada laju di sini (5–16 pasien baru sehari) batas ini praktis
              tidak pernah menggigit.
            </Petunjuk>
          </div>
          <Input id="maxBaris" name="maxBaris" fieldSize="md" type="number" min={0} max={500} defaultValue={nilai.maxBaris} />
        </div>
      </div>

      {rincian === 'ringkas' && (
        <p className="measure text-caption text-muted-foreground">
          Dengan &quot;Ringkas&quot;, variabel <code>{'{daftar_pasien}'}</code> dirender kosong.
          Pastikan isi pesan di bawah tetap masuk akal tanpa daftar nama.
        </p>
      )}

      <fieldset>
        <legend className="mb-1 flex items-center gap-1 text-label">
          Kolom yang harus terisi
          <Petunjuk untuk="arti kolom yang harus terisi">
            Menentukan batas antara <strong>lengkap</strong> dan <strong>terisi sebagian</strong>.
            Berat dan tinggi badan sengaja tidak dicentang secara bawaan: keduanya kosong pada 75%
            dan 91% asesmen yang ada, jadi mencentangnya membuat hampir semua asesmen tergolong
            belum lengkap — dan daftar yang isinya hampir semuanya berhenti dibaca.
          </Petunjuk>
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {KOLOM.map((k) => (
            <label key={k.nilai} className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                name="kolomInti"
                value={k.nilai}
                checked={kolom.includes(k.nilai)}
                onChange={(e) =>
                  setKolom((s) =>
                    e.currentTarget.checked ? [...s, k.nilai] : s.filter((x) => x !== k.nilai),
                  )
                }
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-body">{k.label}</span>
              {k.catatan && <span className="text-caption text-muted-foreground">({k.catatan})</span>}
            </label>
          ))}
        </div>
        {kolom.length === 0 && (
          <p className="mt-1 text-caption text-destructive">
            Pilih minimal satu — tanpa itu setiap asesmen yang barisnya ada langsung dianggap lengkap.
          </p>
        )}
      </fieldset>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <label htmlFor="poli" className="block text-label">
            Batasi ke kode poli
          </label>
          <Petunjuk untuk="arti pembatasan kode poli">
            Kosongkan untuk seluruh poli — dan itu benar selama hanya Poliklinik Umum yang dipakai
            (terukur: 550 dari 550 pasien baru). Isi ini begitu poli lain mulai dipakai, kalau tidak
            pasien poli gigi akan dilaporkan &quot;belum mengisi asesmen umum&quot; padahal yang wajib
            untuknya asesmen gigi.
          </Petunjuk>
        </div>
        <Input id="poli" name="poli" fieldSize="md" defaultValue={nilai.poli} placeholder="kosong = semua poli" />
      </div>

      <div>
        <p className="mb-1 text-label">Isi pesan</p>
        <MessageEditor
          name="body"
          defaultValue={nilai.body}
          variables={REKAP_PENILAIAN_TEMPLATE_VARIABLES}
          rows={9}
        />
      </div>

      <div>
        <p className="mb-1 text-label">Pesan saat semua sudah lengkap</p>
        <MessageEditor
          name="bodyKosong"
          defaultValue={nilai.bodyKosong}
          variables={REKAP_PENILAIAN_TEMPLATE_VARIABLES}
          rows={4}
          hint="Kosongkan supaya sistem DIAM saat tidak ada yang perlu diisi. Pesan harian yang isinya 'tidak ada apa-apa' berhenti dibaca dalam sepekan, dan sejak itu yang sungguhan ikut tidak terbaca."
        />
      </div>

      {hasil.error && <p className="text-label text-destructive">{hasil.error}</p>}
      {hasil.sukses && <p className="text-label text-success">{hasil.sukses}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Simpan
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await pratinjauAction();
              setPratinjau(r.error ?? r.teks ?? '');
            })
          }
        >
          {pending ? 'Menyusun...' : 'Pratinjau'}
        </Button>
      </div>

      {pratinjau !== null && (
        <div>
          <p className="mb-1 text-caption text-muted-foreground">
            Dirender dari pengaturan yang <strong>sudah tersimpan</strong>, bukan dari isi kotak di
            atas — supaya yang terlihat sama dengan yang akan dikirim worker.
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-surface-sunken p-3 text-caption">
            {pratinjau}
          </pre>
        </div>
      )}
    </form>
  );
}
