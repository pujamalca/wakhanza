/**
 * Merakit URL halaman ini sambil MEMBUANG beberapa parameter tertentu.
 *
 * Dipakai tombol-tombol yang membatalkan sesuatu ("Kosongkan centang", "hapus
 * pencarian"): keduanya perlu URL yang sama persis dengan yang sedang dibuka,
 * dikurangi satu-dua kunci. Merakitnya dengan tangan di tiap tombol berarti
 * tiap tombol punya kesempatan sendiri untuk melupakan satu parameter, dan
 * parameter yang terlupa membuang saringan yang sedang aktif tanpa satu pun
 * tanda -- yang terlihat cuma tabel yang tiba-tiba berisi orang lain.
 *
 * **Larik dipertahankan sebagai kunci BERULANG** (`?kab=A&kab=B`), bukan
 * digabung berkoma. Aturan yang sama persis sudah dibayar di
 * `core/pagination.ts`'s `hrefHalaman`, dan sebabnya di sini bahkan lebih
 * tajam: query string kedua halaman broadcast juga mengisi form penyusun di
 * bawahnya, jadi bentuk yang salah tidak cuma memulihkan pilihan wilayah
 * sebagai satu pilihan bernama "A,B" -- ia mengosongkan pekerjaan staf yang
 * sedang berjalan.
 */
export function hrefTanpa(
  basePath: string,
  params: Record<string, string | string[] | undefined>,
  buang: readonly string[],
): string {
  const dibuang = new Set(buang);
  const qs = new URLSearchParams();
  for (const [kunci, nilai] of Object.entries(params)) {
    if (dibuang.has(kunci) || nilai === undefined) continue;
    for (const satu of Array.isArray(nilai) ? nilai : [nilai]) qs.append(kunci, satu);
  }
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
