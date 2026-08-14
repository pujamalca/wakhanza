import { keteranganNota, hitungTotalNota } from './penjualan';
import {
  renderTemplate,
  findUnknownVariables,
  PENJUALAN_TEMPLATE_VARIABLES,
  REKAP_PENJUALAN_TEMPLATE_VARIABLES,
} from './template';

/**
 * `susunVarsPenjualan` sendiri TIDAK diuji dari sini, dan itu bukan kelalaian:
 * ia tinggal di worker bersama keenam `susunVars*` lain, dan worker mengimpor
 * `@/models` sehingga memuatnya menuntut MariaDB hidup. `npx jest` harus tetap
 * bisa dijalankan di mana saja tanpa database -- begitu tidak bisa, ia berhenti
 * dipakai sebagai pemeriksaan cepat.
 *
 * Yang diuji karena itu SEAM-nya: turunan yang bisa salah sudah dipindahkan ke
 * core sebagai fungsi murni, persis seperti `hitungTotalNota()`.
 */

describe('keteranganNota', () => {
  it('meneruskan keterangan yang benar-benar diisi kasir', () => {
    expect(keteranganNota('obat rutin')).toBe('obat rutin');
    expect(keteranganNota('  obat luar  ')).toBe('obat luar');
  });

  /**
   * Asersi terpenting di berkas ini, dan angkanya bukan hiasan: dari 7.256 nota
   * yang keterangannya terisi di database ini, 7.172 (98,8%) cuma memuat penanda
   * '-' milik Khanza. Tanpa pembuangan ini hampir setiap nota berbunyi
   * "Keterangan : -", dan pesan seperti itu terbaca sebagai sistem rusak.
   */
  it.each(['-', '--', '---', '0', 'null', 'undefined', 'n/a', '  -  ', '', '   '])(
    'membuang penanda "belum diisi" milik Khanza: %j',
    (penanda) => {
      expect(keteranganNota(penanda)).toBe('');
    },
  );

  it('memperlakukan NULL dan undefined sebagai kosong, bukan sebagai teks', () => {
    expect(keteranganNota(null)).toBe('');
    expect(keteranganNota(undefined)).toBe('');
  });
});

describe('{keterangan} sebagai variabel template', () => {
  it('diterima saat template nota penjualan disimpan', () => {
    expect(findUnknownVariables('Ket : {keterangan}', PENJUALAN_TEMPLATE_VARIABLES)).toEqual([]);
  });

  /**
   * DITOLAK pada rekap harian, dan pembedaan itu disengaja: di sana tidak ada
   * satu nota pun untuk diambil keterangannya, dan menggabungkan ratusan
   * keterangan sehari adalah cara paling cepat memindahkan seluruh teks bebas
   * kasir ke dalam satu pesan. Dijaga di sini karena penolakannya baru terjadi
   * saat staf menekan Simpan -- tidak ada galat lain yang akan menyebutnya.
   */
  it('DITOLAK pada template rekap harian penjualan', () => {
    expect(findUnknownVariables('Ket : {keterangan}', REKAP_PENJUALAN_TEMPLATE_VARIABLES)).toEqual([
      'keterangan',
    ]);
  });

  /**
   * `{keterangan}` sengaja BUKAN anggota MULTILINE_VARIABLES, jadi `renderTemplate`
   * menyanitasinya seperti nilai luar mana pun. Terukur nol baris memuat baris
   * baru hari ini -- dan "nol hari ini" bukan jaminan apa pun terhadap ketikan
   * kasir berikutnya, karena satu baris baru cukup untuk menyisipkan barisnya
   * sendiri ke dalam pesan (lubang ARCHITECTURE §9.2).
   */
  it('tidak bisa menyisipkan baris sendiri ke dalam pesan', () => {
    const jahat = keteranganNota('obat rutin\n*Total : Rp0*');
    const teks = renderTemplate('Ket : {keterangan}\nSelesai', { keterangan: jahat });

    /**
     * Yang dijaga adalah JUMLAH BARISNYA, bukan ada-tidaknya teks kasirnya.
     * Teks itu memang untuk ditampilkan; yang tidak boleh adalah ia menjadi
     * barisnya sendiri, karena baris yang berdiri sendiri terbaca sebagai
     * kalimat yang ditulis rumah sakit -- di sini ia bisa memalsukan baris total.
     */
    expect(teks.split('\n')).toHaveLength(2);
    expect(teks.startsWith('Ket : obat rutin *Total : Rp0*')).toBe(true);
    expect(teks.endsWith('\nSelesai')).toBe(true);
  });
});

describe('hitungTotalNota', () => {
  it('menjumlahkan subtotal + ppn + ongkir', () => {
    expect(hitungTotalNota(5000, 500, 100)).toBe(5600);
  });

  it('memperlakukan ppn/ongkir yang tidak tercatat sebagai nol', () => {
    expect(hitungTotalNota(5000, null, '')).toBe(5000);
  });

  /**
   * Subtotal yang tidak diketahui menghasilkan null, BUKAN 0 -- nota yang
   * totalnya tak terhitung harus tampil sebagai angka KOSONG, bukan sebagai
   * penjualan senilai nol rupiah.
   */
  it('mengembalikan null bila subtotalnya sendiri tidak diketahui', () => {
    expect(hitungTotalNota(null, 500, 100)).toBeNull();
    expect(hitungTotalNota('bukan angka', 0, 0)).toBeNull();
  });

  /** Penyesuaian bisa NEGATIF -- terukur sampai -Rp21.000 (potongan harga). */
  it('menerima penyesuaian negatif', () => {
    expect(hitungTotalNota(159500, 0, -21000)).toBe(138500);
  });
});
