import { parseWaMarkup, toggleMarker, insertAt, type WaNode } from './waFormat';

/** Bentuk ringkas untuk membandingkan pohon token tanpa menulis objek panjang. */
function ringkas(nodes: WaNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value;
      if (n.type === 'var') return `{${n.name}}`;
      return `${n.type}(${ringkas(n.children)})`;
    })
    .join('');
}

describe('parseWaMarkup', () => {
  it('mengenali empat gaya WhatsApp', () => {
    expect(ringkas(parseWaMarkup('*tebal*'))).toBe('bold(tebal)');
    expect(ringkas(parseWaMarkup('_miring_'))).toBe('italic(miring)');
    expect(ringkas(parseWaMarkup('~coret~'))).toBe('strike(coret)');
    expect(ringkas(parseWaMarkup('```mono```'))).toBe('mono(mono)');
  });

  it('teks biasa di sekitar penanda tetap utuh', () => {
    expect(ringkas(parseWaMarkup('halo *dunia* apa kabar'))).toBe('halo bold(dunia) apa kabar');
  });

  it('dua penanda terpisah di satu baris keduanya terbaca', () => {
    expect(ringkas(parseWaMarkup('*satu* dan *dua*'))).toBe('bold(satu) dan bold(dua)');
  });

  it('gaya bersarang', () => {
    expect(ringkas(parseWaMarkup('*_tebal miring_*'))).toBe('bold(italic(tebal miring))');
  });

  it('variabel dikenali sebagai token tersendiri, termasuk di dalam gaya', () => {
    expect(ringkas(parseWaMarkup('Halo {nama_pasien}!'))).toBe('Halo {nama_pasien}!');
    expect(ringkas(parseWaMarkup('*{nama_rs}*'))).toBe('bold({nama_rs})');
  });

  it('TIDAK menganggap tanda bintang di kalimat biasa sebagai tebal', () => {
    // Penanda pembuka yang diikuti spasi bukan penanda -- kalau ini salah,
    // pratinjau menampilkan tebal padahal WhatsApp menampilkan bintangnya.
    expect(ringkas(parseWaMarkup('harga 5 * 3 * 2'))).toBe('harga 5 * 3 * 2');
  });

  it('penanda yang tidak berpasangan dibiarkan apa adanya', () => {
    expect(ringkas(parseWaMarkup('*belum ditutup'))).toBe('*belum ditutup');
  });

  it('penanda kosong bukan gaya', () => {
    expect(ringkas(parseWaMarkup('**'))).toBe('**');
  });

  it('teks kosong menghasilkan larik kosong', () => {
    expect(parseWaMarkup('')).toEqual([]);
  });

  it('baris baru dipertahankan', () => {
    expect(ringkas(parseWaMarkup('baris satu\n*baris dua*'))).toBe('baris satu\nbold(baris dua)');
  });
});

describe('toggleMarker', () => {
  it('membungkus teks terpilih', () => {
    const r = toggleMarker('halo dunia', 5, 10, 'bold');
    expect(r.value).toBe('halo *dunia*');
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('dunia');
  });

  it('menekan dua kali melepas penandanya lagi, bukan menumpuk', () => {
    const sekali = toggleMarker('halo dunia', 5, 10, 'bold');
    const dua = toggleMarker(sekali.value, sekali.selStart, sekali.selEnd, 'bold');
    expect(dua.value).toBe('halo dunia');
  });

  it('melepas penanda ketika ikut terpilih', () => {
    const r = toggleMarker('halo *dunia*', 5, 12, 'bold');
    expect(r.value).toBe('halo dunia');
  });

  it('tanpa teks terpilih: menyisipkan sepasang dan menaruh kursor di tengah', () => {
    const r = toggleMarker('halo ', 5, 5, 'italic');
    expect(r.value).toBe('halo __');
    expect(r.selStart).toBe(6);
    expect(r.selEnd).toBe(6);
  });

  it('mono memakai penanda tiga karakter', () => {
    const r = toggleMarker('kode', 0, 4, 'mono');
    expect(r.value).toBe('```kode```');
    expect(r.selStart).toBe(3);
  });
});

describe('insertAt', () => {
  it('menyisipkan di posisi kursor', () => {
    const r = insertAt('Halo , apa kabar', 5, 5, '{nama_pasien}');
    expect(r.value).toBe('Halo {nama_pasien}, apa kabar');
    expect(r.caret).toBe(18);
  });

  it('mengganti teks yang sedang terpilih', () => {
    const r = insertAt('Halo NAMA', 5, 9, '{nama_pasien}');
    expect(r.value).toBe('Halo {nama_pasien}');
  });
});
