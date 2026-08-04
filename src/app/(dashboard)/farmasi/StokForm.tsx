'use client';

import { useActionState, useState } from 'react';
import { Input, Select, Button, MessageEditor, Badge } from '@/components/ui';
import { STOK_TEMPLATE_VARIABLES } from '@/core/template';
import { simpanStokAction, ujiStokAction, type HasilForm, type HasilUji } from './actions';

export interface NilaiStok {
  mode: 'mati' | 'petugas' | 'semua';
  keywords: string;
  maxHasil: number;
  harga: 'ralan' | 'jualbebas';
  template: string;
  templateKosong: string;
  templateTanpaNama: string;
}

/**
 * Ketiga mode dijelaskan lewat AKIBATNYA, bukan nama teknisnya. "petugas" tidak
 * memberi tahu siapa pun bahwa daftarnya diambil dari tujuan farmasi yang sudah
 * terpasang di atas, dan "semua" tidak memberi tahu bahwa angka persediaan
 * disembunyikan pada mode itu.
 */
const MODE: { nilai: NilaiStok['mode']; judul: string; keterangan: string }[] = [
  {
    nilai: 'mati',
    judul: 'Mati',
    keterangan: 'Pertanyaan stok dan harga tidak dijawab otomatis. Tetap diteruskan ke aturan di Balasan otomatis.',
  },
  {
    nilai: 'petugas',
    judul: 'Hanya petugas apotek',
    keterangan:
      'Dijawab hanya untuk tujuan di atas yang dicentang "Boleh tanya". Jawabannya memuat ANGKA sisa stok berikut tanda (menipis)/(habis).',
  },
  {
    nilai: 'semua',
    judul: 'Siapa saja yang bertanya',
    keterangan:
      'Siapa pun yang mengirim pesan pribadi ke nomor rumah sakit ikut dijawab, TANPA angka persediaan — hanya "tersedia"/"kosong" berikut harganya. Tujuan yang dicentang "Boleh tanya" tetap mendapat angkanya.',
  },
];

export function StokForm({ nilai }: { nilai: NilaiStok }) {
  const [mode, setMode] = useState(nilai.mode);
  const [state, formAction, isPending] = useActionState(
    async (prev: HasilForm, formData: FormData) => simpanStokAction(prev, formData),
    {},
  );
  const [uji, ujiAction, ujiPending] = useActionState(
    async (prev: HasilUji, formData: FormData) => ujiStokAction(prev, formData),
    {},
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium">Siapa yang dijawab</legend>
          {MODE.map((m) => (
            <label
              key={m.nilai}
              className={`flex cursor-pointer gap-2 rounded-md border p-2 ${
                mode === m.nilai ? 'border-primary bg-primary/5' : 'border-transparent'
              }`}
            >
              <input
                type="radio"
                name="farmasi.stok_mode"
                value={m.nilai}
                className="mt-1"
                checked={mode === m.nilai}
                onChange={() => setMode(m.nilai)}
              />
              <span className="block">
                <span className="block text-sm font-medium">{m.judul}</span>
                <span className="block text-xs text-muted-foreground">{m.keterangan}</span>
              </span>
            </label>
          ))}
          {/* Ditulis di sini, bukan cuma di kolom tabelnya: kalimat "siapa saja
              yang bertanya" gampang terbaca seolah termasuk grup, padahal grup
              justru satu-satunya yang TIDAK pernah lolos tanpa didaftarkan. */}
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            <span className="font-medium">Grup selalu perlu didaftarkan, apa pun modenya.</span> Nomor rumah sakit hanya
            ikut menjawab di dalam grup yang dicentang <span className="font-medium">&ldquo;Boleh tanya&rdquo;</span> pada
            tabel Tujuan pengiriman di atas — mode &ldquo;siapa saja&rdquo; berlaku untuk pesan pribadi, bukan untuk grup
            mana pun yang kebetulan mengundang nomor RS. Di dalam grup, hanya pertanyaan stok yang dijawab; aturan di
            Balasan otomatis sengaja tidak ikut berlaku, dan ada kuota jawaban per jam per grup.
          </p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1 sm:col-span-1">
            <span className="block text-xs font-medium">Kata kunci</span>
            <Input name="farmasi.stok_keywords" defaultValue={nilai.keywords} className="w-full" fieldSize="sm" />
            <span className="block text-xs text-muted-foreground">
              Dipisah koma, dicocokkan sebagai kata utuh. Diperiksa <span className="font-medium">sebelum</span> aturan
              Balasan otomatis, jadi hindari kata yang terlalu umum.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium">Maksimal obat per jawaban</span>
            <Input
              name="farmasi.stok_max_hasil"
              type="number"
              min={1}
              max={20}
              defaultValue={nilai.maxHasil}
              className="w-full"
              fieldSize="sm"
            />
            <span className="block text-xs text-muted-foreground">
              Pencariannya sebagian nama, jadi satu kata bisa cocok dengan belasan barang.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium">Harga yang disebut</span>
            <Select name="farmasi.stok_harga" defaultValue={nilai.harga} fieldSize="sm" className="w-full">
              <option value="jualbebas">Jual bebas (beli langsung di loket)</option>
              <option value="ralan">Rawat jalan (tarif pasien poliklinik)</option>
            </Select>
            <span className="block text-xs text-muted-foreground">
              Keduanya ada di Khanza dan sering berbeda — yang keliru membuat orang datang membawa uang yang salah.
            </span>
          </label>
        </div>

        <div className="space-y-1">
          <span className="block text-xs font-medium">Jawaban saat obatnya ketemu</span>
          <MessageEditor
            name="farmasi.stok_template"
            defaultValue={nilai.template}
            variables={STOK_TEMPLATE_VARIABLES}
            rows={5}
          />
          <span className="block text-xs text-muted-foreground">
            Wajib memuat <span className="font-mono">{'{stok_obat}'}</span> — itulah bagian yang berisi daftar obat,
            sisa stok, dan harganya.
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-xs font-medium">Jawaban saat obatnya tidak ada di daftar</span>
            <MessageEditor
              name="farmasi.stok_template_kosong"
              defaultValue={nilai.templateKosong}
              variables={STOK_TEMPLATE_VARIABLES}
              rows={3}
              showPreview={false}
            />
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium">Jawaban saat nama obatnya tidak disebut</span>
            <MessageEditor
              name="farmasi.stok_template_tanpa_nama"
              defaultValue={nilai.templateTanpaNama}
              variables={STOK_TEMPLATE_VARIABLES}
              rows={3}
              showPreview={false}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Kotak yang dikosongkan berarti <span className="font-medium text-foreground">sengaja tidak menjawab</span>{' '}
          untuk keadaan itu — sama seperti pesan cadangan di Balasan otomatis.
        </p>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.sukses && <p className="text-sm text-success">{state.sukses}</p>}

        <div className="flex justify-end border-t pt-3">
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Menyimpan...' : 'Simpan pengaturan stok'}
          </Button>
        </div>
      </form>

      {/* Kotak uji memakai fungsi yang SAMA dipanggil worker, jadi yang tampil
          di sini adalah teks yang benar-benar akan terkirim. Tidak mengirim
          apa pun, dan mengabaikan mode akses -- yang sedang diuji adalah kata
          kunci dan isi jawabannya. */}
      <form action={ujiAction} className="space-y-2 rounded-lg border p-3">
        <span className="block text-xs font-medium">Uji coba</span>
        <div className="flex flex-wrap gap-2">
          <Input
            name="teks"
            placeholder='mis. "stok paracetamol" atau "berapa harga paramex"'
            className="min-w-56 flex-1"
            fieldSize="sm"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={ujiPending}>
            {ujiPending ? 'Memeriksa...' : 'Coba'}
          </Button>
        </div>
        {uji.error && <p className="text-xs text-destructive">{uji.error}</p>}
        {uji.hasil && (
          <div className="space-y-1">
            {uji.cabang && (
              <Badge variant="neutral">
                {uji.cabang === 'ketemu' ? 'Obat ditemukan' : uji.cabang === 'kosong' ? 'Tidak ada di daftar' : 'Nama obat tidak disebut'}
              </Badge>
            )}
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{uji.hasil}</pre>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Membaca stok dan harga dari SIMRS Khanza secara langsung, tanpa mengirim pesan apa pun.
        </p>
      </form>
    </div>
  );
}
