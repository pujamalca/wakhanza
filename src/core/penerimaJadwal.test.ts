import { hapusPenerima } from './penerimaJadwal';

const MAX = 500;

function jalankan(over: Partial<Parameters<typeof hapusPenerima>[0]> = {}) {
  return hapusPenerima({
    config: { mode: 'semua' },
    penerimaSekarang: ['000001', '000002'],
    buang: '000002',
    maxPilihan: MAX,
    ...over,
  });
}

describe('hapusPenerima', () => {
  it('jadwal berfilter: membuang seorang MENGUBAHNYA jadi daftar tetap', () => {
    const h = jalankan();
    expect(h).toEqual({ boleh: true, sisa: ['000001'], konversi: true });
  });

  it('jadwal yang sudah berdaftar: cuma dikurangi, tanpa konversi', () => {
    const h = jalankan({
      config: { mode: 'pilih', noRkmMedis: ['000001', '000002', '000003'] },
      penerimaSekarang: ['000001', '000002', '000003'],
    });
    expect(h).toEqual({ boleh: true, sisa: ['000001', '000003'], konversi: false });
  });

  it('urutan sisanya dipertahankan -- itu urutan staf mencentangnya', () => {
    const h = jalankan({
      config: { mode: 'pilih', noRkmMedis: ['A', 'B', 'C', 'D'] },
      penerimaSekarang: ['A', 'B', 'C', 'D'],
      buang: 'B',
    });
    expect(h).toEqual({ boleh: true, sisa: ['A', 'C', 'D'], konversi: false });
  });

  /**
   * Pemeriksaan yang paling mahal kalau hilang: daftar KOSONG membuat
   * isPilihSchedule() mengembalikan false, jadi jadwalnya jatuh kembali ke
   * filter aslinya -- mengirim ke SEMUA orang yang cocok, kebalikan persis
   * dari yang diminta, tanpa satu pun galat.
   */
  it('penerima terakhir DITOLAK, dan alasannya menyebut akibatnya', () => {
    const h = jalankan({ penerimaSekarang: ['000001'], buang: '000001' });
    expect(h.boleh).toBe(false);
    if (h.boleh) throw new Error('seharusnya ditolak');
    expect(h.alasan).toMatch(/kembali memakai filter aslinya/);
  });

  it('penerima terakhir DITOLAK juga pada jadwal yang sudah berdaftar', () => {
    const h = jalankan({
      config: { mode: 'pilih', noRkmMedis: ['000001'] },
      penerimaSekarang: ['000001'],
      buang: '000001',
    });
    expect(h.boleh).toBe(false);
  });

  /**
   * Daftar tetap dan tindak lanjut saling meniadakan: mengubahnya jadi daftar
   * akan DIAM-DIAM mematikan kunci idempoten per-kunjungan, sehingga orang
   * yang sama menerima pesan tiap kali jadwal jalan.
   */
  it('jadwal tindak lanjut DITOLAK, dan diarahkan ke daftar tolak', () => {
    const h = jalankan({ config: { mode: 'semua', windowMode: 'followup' } });
    expect(h.boleh).toBe(false);
    if (h.boleh) throw new Error('seharusnya ditolak');
    expect(h.alasan).toMatch(/Daftar tolak/);
  });

  // Jadwal yang SUDAH berdaftar bukan jadwal tindak lanjut, apa pun isi
  // windowMode-nya -- isFollowupSchedule() sudah memutuskan begitu, dan
  // menolaknya di sini akan membuat daftar yang sah mustahil dikurangi.
  it('windowMode followup pada jadwal berdaftar TIDAK menghalangi', () => {
    const h = jalankan({
      config: { mode: 'pilih', noRkmMedis: ['A', 'B'], windowMode: 'followup' },
      penerimaSekarang: ['A', 'B'],
      buang: 'B',
    });
    expect(h).toEqual({ boleh: true, sisa: ['A'], konversi: false });
  });

  it('no. RM yang tidak ada di daftar DITOLAK (tekan ganda / halaman basi)', () => {
    const h = jalankan({ buang: '999999' });
    expect(h.boleh).toBe(false);
    if (h.boleh) throw new Error('seharusnya ditolak');
    expect(h.alasan).toMatch(/Muat ulang halaman/);
  });

  it('segmen kelewat besar tidak bisa dibekukan jadi daftar', () => {
    const banyak = Array.from({ length: 501 }, (_, i) => String(i).padStart(6, '0'));
    const h = jalankan({ penerimaSekarang: banyak, buang: banyak[0], maxPilihan: MAX });
    expect(h.boleh).toBe(false);
    if (h.boleh) throw new Error('seharusnya ditolak');
    expect(h.alasan).toMatch(/501 pasien/);
  });

  // Batas itu milik BENTUK daftar, jadi ia tidak berlaku pada jadwal yang
  // memang sudah berupa daftar -- di sana panjangnya justru sedang dikurangi.
  it('batas TIDAK berlaku pada jadwal yang sudah berdaftar', () => {
    const banyak = Array.from({ length: 501 }, (_, i) => String(i).padStart(6, '0'));
    const h = jalankan({
      config: { mode: 'pilih', noRkmMedis: banyak },
      penerimaSekarang: banyak,
      buang: banyak[0],
      maxPilihan: MAX,
    });
    expect(h.boleh).toBe(true);
  });

  // Urutan pemeriksaan: "tidak ada di daftar" harus menang atas "kelewat
  // besar", kalau tidak staf disuruh mempersempit filter untuk membuang orang
  // yang memang sudah tidak ada.
  it('yang tidak ada di daftar ditolak lebih dulu daripada batas ukuran', () => {
    const banyak = Array.from({ length: 501 }, (_, i) => String(i).padStart(6, '0'));
    const h = jalankan({ penerimaSekarang: banyak, buang: 'TIDAKADA' });
    expect(h.boleh).toBe(false);
    if (h.boleh) throw new Error('seharusnya ditolak');
    expect(h.alasan).toMatch(/Muat ulang halaman/);
  });
});
