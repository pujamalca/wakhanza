import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Gerbang yang menjaga pola lama tidak kembali.
 *
 * Sebelum `Petunjuk` ada, sembilan keterangan berkalimat dititipkan pada
 * atribut `title=` -- enam di antaranya pada satu tabel yang menentukan ke mana
 * data apotek dikirim. Bentuk itu **tidak pernah muncul di layar sentuh sama
 * sekali**, tidak bisa dibuka keyboard, dan tidak diandalkan pembaca layar.
 * Jadi di tablet loket keenamnya hanya berupa kata "Hibah", "Pemesanan",
 * "Penjualan" tanpa satu pun cara mengetahui bedanya.
 *
 * Yang membuat pola itu gampang kembali: ia satu atribut, terlihat rapi di
 * kode, dan **tidak menghasilkan galat apa pun** -- di peramban pengembang
 * (yang punya tetikus) ia bahkan tampak bekerja. Karena itu gerbangnya berupa
 * uji, bukan catatan di dokumentasi.
 *
 * ## Apa yang diperiksa, dan kenapa batasnya PANJANG
 *
 * Yang salah bukan `title=` itu sendiri melainkan `title=` yang memikul
 * KETERANGAN. Sebagian pemakaian lain sah dan harus tetap lolos:
 *
 *   - nilai data yang tampilannya terpotong (`title={t.chatId}`)
 *   - keterangan tambahan pada elemen yang MEMANG interaktif dan sudah punya
 *     teks terlihat (`<button title="Kirim satu pesan uji ke tujuan ini">`)
 *   - label status yang sudah didampingi teks `sr-only` (`Tabs`)
 *
 * Panjang dipakai sebagai penanda "ini kalimat, bukan label": nama kolom dan
 * nilai data hampir selalu pendek, kalimat penjelas hampir selalu tidak.
 * Kesembilan yang dipindahkan berkisar 52-131 karakter; ambang 25 memberi
 * kelonggaran besar sambil tetap menjaring seluruhnya.
 */

const AKAR = join(process.cwd(), 'src', 'app', '(dashboard)');

/** Elemen yang memang bisa difokus dan diklik -- di sana `title` cuma pelengkap. */
const INTERAKTIF = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'option']);

const AMBANG_KALIMAT = 25;

function berkasTsx(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) out.push(...berkasTsx(p));
    else if (nama.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export interface TitleBermasalah {
  berkas: string;
  tag: string;
  teks: string;
}

/**
 * Diekspor supaya bisa dijalankan atas kode buatan di dalam uji -- yaitu
 * satu-satunya cara membuktikan gerbangnya MENGGIGIT tanpa merusak berkas
 * sungguhan lebih dulu.
 *
 * Bentuk yang dikenali: `title="..."`, `title={'...'}`, `title={"..."}`, dan
 * template literal tanpa interpolasi. Ekspresi (`title={t.chatId}`) sengaja
 * dilewati -- panjangnya tidak bisa dinilai dari kode, dan yang sah justru
 * berbentuk itu.
 */
export function cariTitleBerkalimat(kode: string, berkas = '(inline)'): TitleBermasalah[] {
  const hasil: TitleBermasalah[] = [];
  for (const m of kode.matchAll(/<([a-z][\w-]*)((?:[^<>]|\{[^{}]*\})*?)>/g)) {
    const tag = m[1] ?? '';
    const atribut = m[2] ?? '';
    if (INTERAKTIF.has(tag)) continue;

    const literal =
      atribut.match(/\btitle=["']([^"']*)["']/) ??
      atribut.match(/\btitle=\{\s*['"]([^'"]*)['"]\s*\}/) ??
      atribut.match(/\btitle=\{\s*`([^`${}]*)`\s*\}/);
    const teks = literal?.[1];
    if (teks === undefined) continue;

    if (teks.length >= AMBANG_KALIMAT) hasil.push({ berkas, tag, teks });
  }
  return hasil;
}

describe('gerbang: keterangan tidak boleh disembunyikan di balik title=', () => {
  it('tidak ada satu pun di seluruh halaman dashboard', () => {
    const temuan = berkasTsx(AKAR).flatMap((f) =>
      cariTitleBerkalimat(readFileSync(f, 'utf8'), f.slice(AKAR.length + 1).replace(/\\/g, '/')),
    );

    // Pesan gagalnya menyebut jalan keluarnya, bukan cuma bahwa ada yang salah:
    // yang membaca kegagalan ini kemungkinan besar baru menuliskan barisnya.
    expect(
      temuan.map((t) => `${t.berkas} <${t.tag}> "${t.teks}"`),
    ).toEqual([]);
  });

  it('MENGGIGIT pada bentuk yang dulu dipakai', () => {
    // Persis salah satu dari sembilan yang dipindahkan.
    const lama = `<label className="flex" title="Menerima rekap barang yang stoknya di bawah ambang minimal"><input /></label>`;
    expect(cariTitleBerkalimat(lama)).toHaveLength(1);
  });

  it('menjaring juga bentuk berkurung kurawal dan template literal', () => {
    expect(cariTitleBerkalimat(`<span title={'Aturan dengan urutan lebih kecil diperiksa dulu'} />`)).toHaveLength(1);
    expect(cariTitleBerkalimat('<span title={`Aturan dengan urutan lebih kecil diperiksa dulu`} />')).toHaveLength(1);
  });

  it('MELOLOSKAN pemakaian yang sah', () => {
    // 1. nilai data, bukan keterangan -- panjangnya tak bisa dinilai dari kode
    expect(cariTitleBerkalimat(`<span title={t.chatId}>{tampilkanChatId(t.chatId)}</span>`)).toHaveLength(0);
    // 2. elemen interaktif yang teksnya sudah terlihat
    expect(
      cariTitleBerkalimat(`<button title="Kirim satu pesan uji ke tujuan ini">Kirim uji</button>`),
    ).toHaveLength(0);
    // 3. label pendek pada elemen apa pun
    expect(cariTitleBerkalimat(`<span title="Belum tersambung" />`)).toHaveLength(0);
  });
});
