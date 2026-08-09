import { broadcastVars, type BarisSegmen, type IdentitasBroadcast } from './broadcastVars';
import { BROADCAST_TEMPLATE_VARIABLES } from './template';

const IDENTITAS: IdentitasBroadcast = {
  namaRs: 'RSUD Contoh',
  alamatRs: 'Jl. Contoh No. 1',
  kontakRs: '0752-000000',
};

function baris(ubah: Partial<BarisSegmen> = {}): BarisSegmen {
  return {
    no_rkm_medis: '000001',
    nm_pasien: 'Pasien Contoh',
    nm_kab: 'LIMA PULUH KOTA',
    nm_kec: 'HARAU',
    nm_kel: 'TAREK',
    tgl_kunjungan_terakhir: '2026-08-09',
    ...ubah,
  };
}

describe('broadcastVars', () => {
  /**
   * Pemeriksaan yang paling berharga di berkas ini, dan satu-satunya yang
   * menjaga hal yang tidak bisa dilihat dari layar mana pun: daftar yang
   * DIRENDER dan daftar yang BOLEH DIKETIK staf harus membagi habis satu sama
   * lain.
   *
   * Menyimpang ke salah satu arah gagal DIAM, dan keduanya membingungkan ke
   * arah yang berlawanan:
   *
   *   ada di derivasi, tidak di daftar -> `findUnknownVariables` menolaknya saat
   *                                       staf menekan Simpan, padahal nilainya
   *                                       sebenarnya tersedia.
   *   ada di daftar, tidak di derivasi -> lolos disimpan, lalu dirender KOSONG
   *                                       ke seluruh penerima selamanya.
   *
   * Pola yang sama dipakai `outboxStatus.test.ts` dan `labels.test.ts`.
   */
  it('daftar variabel dan hasil derivasinya membagi habis satu sama lain', () => {
    const dihasilkan = Object.keys(broadcastVars(baris(), IDENTITAS)).sort();
    const diizinkan = [...BROADCAST_TEMPLATE_VARIABLES].sort();
    expect(dihasilkan).toEqual(diizinkan);
  });

  /**
   * Pengecualian yang disengaja, dipatok supaya tidak "dirapikan" belakangan.
   * {tanggal}/{jam} pada broadcast berarti waktu KIRIM, dan jam tenang bisa
   * menggesernya sembilan jam melewati pergantian hari -- lihat komentar di
   * BROADCAST_TEMPLATE_VARIABLES.
   */
  it('tidak menyediakan variabel yang terikat satu kejadian atau waktu kirim', () => {
    const daftar: readonly string[] = BROADCAST_TEMPLATE_VARIABLES;
    for (const terlarang of ['tanggal', 'jam', 'cara_bayar', 'nama_poli', 'nama_dokter', 'no_antrian']) {
      expect(daftar).not.toContain(terlarang);
    }
  });

  it('memetakan identitas RS dan identitas pasien', () => {
    const v = broadcastVars(baris(), IDENTITAS);
    expect(v.nama_rs).toBe('RSUD Contoh');
    expect(v.alamat_rs).toBe('Jl. Contoh No. 1');
    expect(v.kontak_rs).toBe('0752-000000');
    expect(v.nama_pasien).toBe('Pasien Contoh');
    expect(v.no_rm).toBe('000001');
  });

  it('nama pasien yang NULL jadi string kosong, bukan "null"', () => {
    expect(broadcastVars(baris({ nm_pasien: null }), IDENTITAS).nama_pasien).toBe('');
  });

  describe('wilayah', () => {
    it('meneruskan nama wilayah yang sungguhan', () => {
      const v = broadcastVars(baris(), IDENTITAS);
      expect(v.kelurahan).toBe('TAREK');
      expect(v.kecamatan).toBe('HARAU');
      expect(v.kabupaten).toBe('LIMA PULUH KOTA');
    });

    /**
     * Inti perlindungannya. Khanza memakai NAMA TABELNYA sendiri sebagai isian
     * bawaan, dan di mesin ini 89% pasien memilikinya -- diteruskan apa adanya,
     * hampir setiap broadcast berbunyi "Warga KECAMATAN,".
     */
    it('membuang penanda bawaan Khanza yang berupa nama tabelnya sendiri', () => {
      const v = broadcastVars(
        baris({ nm_kel: 'KELURAHAN', nm_kec: 'KECAMATAN', nm_kab: 'KABUPATEN' }),
        IDENTITAS,
      );
      expect(v.kelurahan).toBe('');
      expect(v.kecamatan).toBe('');
      expect(v.kabupaten).toBe('');
    });

    it('membuang penanda umum dan nilai kosong', () => {
      const v = broadcastVars(baris({ nm_kel: '-', nm_kec: null, nm_kab: '   ' }), IDENTITAS);
      expect(v.kelurahan).toBe('');
      expect(v.kecamatan).toBe('');
      expect(v.kabupaten).toBe('');
    });
  });

  describe('tanggal_kunjungan', () => {
    it('dirender sebagai tanggal yang dibaca manusia', () => {
      expect(broadcastVars(baris(), IDENTITAS).tanggal_kunjungan).toBe('9 Agustus 2026');
    });

    /**
     * Penanda "belum" milik Khanza. Tanpa penjagaan ini pesannya berbunyi
     * "kunjungan Anda pada Invalid Date".
     */
    it('penanda 0000-00-00 jadi kosong, bukan Invalid Date', () => {
      expect(broadcastVars(baris({ tgl_kunjungan_terakhir: '0000-00-00' }), IDENTITAS).tanggal_kunjungan).toBe('');
    });

    it('NULL jadi kosong', () => {
      expect(broadcastVars(baris({ tgl_kunjungan_terakhir: null }), IDENTITAS).tanggal_kunjungan).toBe('');
    });
  });
});
