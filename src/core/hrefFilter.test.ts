import { hrefTanpa } from './hrefFilter';

describe('hrefTanpa', () => {
  it('membuang kunci yang diminta, menahan sisanya', () => {
    const href = hrefTanpa('/broadcast', { cari: 'Budi', dateFrom: '2026-01-01' }, ['cari']);
    expect(href).toBe('/broadcast?dateFrom=2026-01-01');
  });

  it('bisa membuang beberapa kunci sekaligus', () => {
    const href = hrefTanpa('/broadcast', { mode: 'pilih', rm: ['A', 'B'], cari: 'Budi' }, ['rm', 'mode']);
    expect(href).toBe('/broadcast?cari=Budi');
  });

  /**
   * ATURAN YANG GAGAL DIAM, dan sebabnya sama persis dengan yang sudah dibayar
   * di `hrefHalaman`: larik WAJIB pulang sebagai kunci berulang. Digabung
   * berkoma, pilihan wilayah pulih sebagai satu pilihan bernama "3374,3375"
   * yang tidak cocok dengan apa pun -- dan di /broadcast-terjadwal query string
   * yang sama juga mengisi form penyusun, jadi yang hilang bukan cuma
   * saringannya melainkan pekerjaan staf yang sedang berjalan.
   */
  it('larik dipertahankan sebagai kunci BERULANG', () => {
    const href = hrefTanpa('/broadcast', { kab: ['3374', '3375'], cari: 'Budi' }, ['cari']);
    expect(href).toBe('/broadcast?kab=3374&kab=3375');
    expect(href).not.toContain('3374%2C3375');
  });

  it('undefined dilewati, larik kosong tidak meninggalkan kunci', () => {
    expect(hrefTanpa('/broadcast', { cari: undefined, rm: [], pj: 'A02' }, [])).toBe('/broadcast?pj=A02');
  });

  // Tanpa satu pun parameter tersisa, tanda tanya menggantung ("/broadcast?")
  // tetap bekerja tapi ikut tersalin saat staf menyalin tautannya.
  it('tanpa sisa parameter -> tanpa tanda tanya', () => {
    expect(hrefTanpa('/broadcast', { cari: 'Budi' }, ['cari'])).toBe('/broadcast');
    expect(hrefTanpa('/broadcast', {}, [])).toBe('/broadcast');
  });

  it('nilai disandikan, bukan disambung mentah', () => {
    const href = hrefTanpa('/broadcast', { cari: 'Budi & Siti', pj: 'A 02' }, []);
    expect(href).toBe('/broadcast?cari=Budi+%26+Siti&pj=A+02');
  });

  // Membuang kunci yang memang tidak ada bukan galat -- pemanggilnya menyerahkan
  // seluruh searchParams apa adanya, dan isinya berbeda-beda tiap halaman.
  it('membuang kunci yang tidak ada tidak mengubah apa pun', () => {
    expect(hrefTanpa('/broadcast', { pj: 'A02' }, ['cari', 'rm'])).toBe('/broadcast?pj=A02');
  });
});
