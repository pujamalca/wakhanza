/**
 * Markup WhatsApp -> pohon token, untuk pratinjau di dashboard.
 *
 * WhatsApp BUKAN HTML. Ia mengenali empat penanda di dalam teks biasa:
 *
 *   *tebal*   _miring_   ~coret~   ```mono```
 *
 * Itu sebabnya kotak pesan di dashboard tidak boleh memakai editor WYSIWYG
 * biasa: editor semacam itu menghasilkan `<b>`/`<i>`, dan tag itu akan terkirim
 * APA ADANYA ke pasien -- pesan rumah sakit berisi kode HTML mentah. Yang
 * dibutuhkan adalah editor yang menulis penanda WhatsApp, dan pratinjau yang
 * membacanya kembali. Berkas ini setengah yang kedua.
 *
 * Fungsi murni tanpa React, supaya bisa diuji unit tanpa merender apa pun.
 */

export type WaNode =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string }
  | { type: 'bold' | 'italic' | 'strike' | 'mono'; children: WaNode[] };

export type WaStyle = 'bold' | 'italic' | 'strike' | 'mono';

/** Penanda pembuka/penutup per gaya. Urutan penting: ``` diperiksa sebelum `. */
export const WA_MARKERS: Record<WaStyle, string> = {
  mono: '```',
  bold: '*',
  italic: '_',
  strike: '~',
};

const ORDER: WaStyle[] = ['mono', 'bold', 'italic', 'strike'];

const VAR_RE = /\{(\w+)\}/g;

/** Memecah teks biasa menjadi potongan teks dan variabel `{nama}`. */
function splitVariables(text: string): WaNode[] {
  const out: WaNode[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index! > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'var', name: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/**
 * Mencari pasangan penanda yang SAH, meniru aturan WhatsApp secukupnya:
 * penanda pembuka tidak boleh langsung diikuti spasi, penutup tidak boleh
 * langsung didahului spasi, dan isinya tidak boleh kosong. Tanpa aturan itu,
 * kalimat biasa seperti "harga 5 * 3 * 2" akan tampil sebagai teks tebal di
 * pratinjau padahal WhatsApp menampilkannya apa adanya -- pratinjau yang
 * berbohong lebih buruk daripada tanpa pratinjau.
 */
function findPair(text: string, style: WaStyle, from: number): { open: number; close: number } | null {
  const marker = WA_MARKERS[style];
  let i = from;
  while (i < text.length) {
    const open = text.indexOf(marker, i);
    if (open === -1) return null;
    const afterOpen = open + marker.length;
    const nextChar = text[afterOpen];
    if (nextChar === undefined || /\s/.test(nextChar)) {
      i = afterOpen;
      continue;
    }
    const close = text.indexOf(marker, afterOpen);
    if (close === -1) return null;
    const beforeClose = text[close - 1];
    if (close === afterOpen || (beforeClose !== undefined && /\s/.test(beforeClose))) {
      i = afterOpen;
      continue;
    }
    return { open, close };
  }
  return null;
}

/** Mengurai satu tingkat gaya, lalu memanggil dirinya untuk isi di dalamnya (mis. *_tebal miring_*). */
function parseFrom(text: string, styleIndex: number): WaNode[] {
  if (styleIndex >= ORDER.length) return splitVariables(text);

  const style = ORDER[styleIndex]!;
  const marker = WA_MARKERS[style];
  const pair = findPair(text, style, 0);
  if (!pair) return parseFrom(text, styleIndex + 1);

  const before = text.slice(0, pair.open);
  const inside = text.slice(pair.open + marker.length, pair.close);
  const after = text.slice(pair.close + marker.length);

  return [
    ...(before ? parseFrom(before, styleIndex + 1) : []),
    // Isi diurai mulai dari gaya BERIKUTNYA, bukan dari awal: tanpa itu
    // penanda yang sama di dalam dirinya sendiri bisa berulang tanpa henti.
    { type: style, children: parseFrom(inside, styleIndex + 1) },
    // Sisa teks diurai ulang dari gaya YANG SAMA supaya *dua* *tebal
    // terpisah* di satu baris keduanya terbaca.
    ...(after ? parseFrom(after, styleIndex) : []),
  ];
}

export function parseWaMarkup(text: string): WaNode[] {
  if (!text) return [];
  return parseFrom(text, 0);
}

/**
 * Menyisipkan/membungkus penanda pada rentang terpilih di kotak teks.
 *
 * Dikembalikan sebagai nilai baru + posisi kursor, bukan mengubah DOM
 * langsung, supaya logikanya bisa diuji tanpa peramban.
 *
 * Bila rentangnya sudah dibungkus penanda yang sama, penandanya DILEPAS --
 * tombol tebal yang ditekan dua kali harus mengembalikan keadaan semula, bukan
 * menghasilkan `**tebal**` yang di WhatsApp malah tampil sebagai tanda bintang.
 */
export function toggleMarker(
  value: string,
  selStart: number,
  selEnd: number,
  style: WaStyle,
): { value: string; selStart: number; selEnd: number } {
  const marker = WA_MARKERS[style];
  const len = marker.length;
  const selected = value.slice(selStart, selEnd);

  const sudahDibungkusDiLuar =
    value.slice(Math.max(0, selStart - len), selStart) === marker && value.slice(selEnd, selEnd + len) === marker;
  if (sudahDibungkusDiLuar) {
    return {
      value: value.slice(0, selStart - len) + selected + value.slice(selEnd + len),
      selStart: selStart - len,
      selEnd: selEnd - len,
    };
  }

  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > len * 2) {
    const dalam = selected.slice(len, -len);
    return { value: value.slice(0, selStart) + dalam + value.slice(selEnd), selStart, selEnd: selStart + dalam.length };
  }

  // Tanpa teks terpilih: sisipkan sepasang penanda dan taruh kursor di antaranya.
  if (selStart === selEnd) {
    return {
      value: value.slice(0, selStart) + marker + marker + value.slice(selEnd),
      selStart: selStart + len,
      selEnd: selStart + len,
    };
  }

  return {
    value: value.slice(0, selStart) + marker + selected + marker + value.slice(selEnd),
    selStart: selStart + len,
    selEnd: selEnd + len,
  };
}

/** Menyisipkan `{nama}` di posisi kursor, mengganti teks terpilih bila ada. */
export function insertAt(value: string, selStart: number, selEnd: number, teks: string): { value: string; caret: number } {
  return { value: value.slice(0, selStart) + teks + value.slice(selEnd), caret: selStart + teks.length };
}
