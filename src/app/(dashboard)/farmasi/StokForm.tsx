'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Input, Select, Button, MessageEditor, Badge } from '@/components/ui';
import { STOK_TEMPLATE_VARIABLES } from '@/core/template';
import { simpanStokAction, ujiStokAction, type HasilForm, type HasilUji } from './actions';

export interface NilaiStok {
  mode: 'mati' | 'petugas' | 'semua';
  keywords: string;
  keywordsKetersediaan: string;
  maxHasil: number;
  harga: 'ralan' | 'jualbebas';
  rincianUmum: 'ringkas' | 'harga';
  template: string;
  templateUmum: string;
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
      'Dijawab hanya untuk tujuan yang dicentang "Boleh tanya" di tab Tujuan pengiriman. Jawabannya memuat ANGKA sisa stok berikut tanda (menipis)/(habis).',
  },
  {
    nilai: 'semua',
    judul: 'Siapa saja yang bertanya',
    keterangan:
      'Siapa pun yang mengirim pesan pribadi ke nomor rumah sakit ikut dijawab, TANPA angka persediaan — bentuknya diatur di "Rincian untuk nomor umum" di bawah. Tujuan yang dicentang "Boleh tanya" tetap mendapat angkanya.',
  },
];

const RINCIAN_UMUM: { nilai: NilaiStok['rincianUmum']; judul: string }[] = [
  { nilai: 'ringkas', judul: 'Nama obat + tersedia/kosong saja' },
  { nilai: 'harga', judul: 'Nama obat + tersedia/kosong + harga' },
];

export function StokForm({ nilai }: { nilai: NilaiStok }) {
  const [mode, setMode] = useState(nilai.mode);
  const [rincian, setRincian] = useState(nilai.rincianUmum);
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
            ikut menjawab di dalam grup yang dicentang <span className="font-medium">&ldquo;Boleh tanya&rdquo;</span> di{' '}
            <Link href="/farmasi?tab=tujuan" className="font-medium underline">
              tab Tujuan pengiriman
            </Link>{' '}
            — mode &ldquo;siapa saja&rdquo; berlaku untuk pesan pribadi, bukan untuk grup mana pun yang kebetulan
            mengundang nomor RS. Di dalam grup, hanya pertanyaan stok yang dijawab; aturan di Balasan otomatis sengaja
            tidak ikut berlaku, dan ada kuota jawaban per jam per grup.
          </p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium">Kata kunci — selalu dijawab</span>
            <Input name="farmasi.stok_keywords" defaultValue={nilai.keywords} className="w-full" fieldSize="sm" />
            <span className="block text-xs text-muted-foreground">
              Dipisah koma, dicocokkan sebagai kata utuh. Kalau obatnya tidak ketemu, tetap dijawab{' '}
              <span className="font-medium">&ldquo;tidak ditemukan&rdquo;</span> — jadi hindari kata yang terlalu umum.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium">Kata tanya ketersediaan — dijawab kalau obatnya ketemu</span>
            <Input
              name="farmasi.stok_keywords_ketersediaan"
              defaultValue={nilai.keywordsKetersediaan}
              className="w-full"
              fieldSize="sm"
              placeholder="adakah, apotek, jual, obat"
            />
            <span className="block text-xs text-muted-foreground">
              Untuk pertanyaan sehari-hari seperti{' '}
              <span className="font-medium">&ldquo;apotek adakah obat paracetamol&rdquo;</span> atau{' '}
              <span className="font-medium">&ldquo;ada amlodipin?&rdquo;</span>. Dua pagar menjaganya: kalau namanya
              tidak ada di katalog, atau kalau pesannya cocok dengan{' '}
              <Link href="/balasan-otomatis" className="font-medium underline">
                sebuah aturan Balasan otomatis
              </Link>
              , pesannya <span className="font-medium">diteruskan</span> ke sana — bukan dijawab &ldquo;tidak
              ditemukan&rdquo;. Itu yang membuat &ldquo;ada dokter jaga?&rdquo; dan &ldquo;ada poli apa&rdquo; tidak
              ikut terjaring. Kosongkan untuk mematikannya.
            </span>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
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

          <label className="block space-y-1">
            <span className="block text-xs font-medium">Rincian untuk nomor umum</span>
            <Select
              name="farmasi.stok_rincian_umum"
              value={rincian}
              onChange={(e) => setRincian(e.target.value as NilaiStok['rincianUmum'])}
              fieldSize="sm"
              className="w-full"
            >
              {RINCIAN_UMUM.map((r) => (
                <option key={r.nilai} value={r.nilai}>
                  {r.judul}
                </option>
              ))}
            </Select>
            <span className="block text-xs text-muted-foreground">
              Angka sisa stok tidak pernah ikut ke nomor umum, apa pun pilihannya — itu hanya untuk tujuan yang
              dicentang &ldquo;Boleh tanya&rdquo;.
            </span>
          </label>
        </div>

        {rincian === 'ringkas' && (
          /* Ditulis di sini, bukan cuma diketahui dari pilihannya: kata kunci
             "harga" tetap menjaring pertanyaan harga, dan orangnya lalu menerima
             jawaban yang justru tidak memuat harga. Itu perilaku yang benar
             (harga di Khanza belum tentu siap diumumkan), tapi hanya kalau teks
             pembungkusnya mengarahkan ke manusia -- kalau tidak, yang terbaca
             adalah sistem yang tidak menjawab pertanyaan. */
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
            Pertanyaan <span className="font-medium">harga</span> dari nomor umum tetap dijawab, tapi jawabannya tidak
            memuat harga. Pastikan teks &ldquo;Jawaban untuk nomor umum&rdquo; di bawah mengarahkan mereka menanyakan
            harga lewat {'{kontak_rs}'}.
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-xs font-medium">Jawaban saat obatnya ketemu — untuk petugas apotek</span>
            <MessageEditor
              name="farmasi.stok_template"
              defaultValue={nilai.template}
              variables={STOK_TEMPLATE_VARIABLES}
              rows={5}
            />
            <span className="block text-xs text-muted-foreground">
              Wajib memuat <span className="font-mono">{'{stok_obat}'}</span> — di sini isinya angka sisa stok, satuan,
              harga, dan tanda (menipis)/(habis).
            </span>
          </div>

          <div className="space-y-1">
            <span className="block text-xs font-medium">Jawaban saat obatnya ketemu — untuk nomor umum</span>
            <MessageEditor
              name="farmasi.stok_template_umum"
              defaultValue={nilai.templateUmum}
              variables={STOK_TEMPLATE_VARIABLES}
              rows={5}
            />
            <span className="block text-xs text-muted-foreground">
              Terpisah karena isinya memang beda: <span className="font-mono">{'{stok_obat}'}</span> di sini hanya
              memuat nama obat dan tersedia/kosong, jadi kalimat tentang harga di teks petugas tidak berlaku.
            </span>
          </div>
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
            placeholder='mis. "apotek adakah obat paracetamol" atau "stok paramex"'
            className="min-w-56 flex-1"
            fieldSize="sm"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={ujiPending}>
            {ujiPending ? 'Memeriksa...' : 'Coba'}
          </Button>
        </div>
        {uji.error && <p className="text-xs text-destructive">{uji.error}</p>}
        {uji.hasil && <p className="rounded-md bg-muted p-2 text-xs">{uji.hasil}</p>}
        {uji.petugas !== undefined && (
          <div className="space-y-2">
            {uji.cabang && (
              <Badge variant="neutral">
                {uji.cabang === 'ketemu'
                  ? 'Obat ditemukan'
                  : uji.cabang === 'kosong'
                    ? 'Tidak ada di daftar'
                    : 'Nama obat tidak disebut'}
              </Badge>
            )}
            {/* Keduanya ditampilkan sekaligus supaya bentuk jawaban untuk nomor
                umum bisa dilihat TANPA menyalakan mode "siapa saja" lebih dulu
                -- kalau tidak, satu-satunya cara mengujinya adalah di hadapan
                orang sungguhan. */}
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="space-y-1">
                <span className="block text-xs font-medium">Yang diterima petugas apotek</span>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{uji.petugas}</pre>
              </div>
              <div className="space-y-1">
                <span className="block text-xs font-medium">Yang diterima nomor umum</span>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{uji.umum}</pre>
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Membaca stok dan harga dari SIMRS Khanza secara langsung, tanpa mengirim pesan apa pun. Mengabaikan mode
          akses — yang diuji kata kunci dan isi jawabannya, bukan apakah nomor Anda sendiri berhak bertanya.
        </p>
      </form>
    </div>
  );
}
