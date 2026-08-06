import {
  isianSurat,
  rakitAlamat,
  formatTanggalSurat,
  formatUmurSurat,
  jenisKelaminLengkap,
  barisTerisi,
  namaBerkasSurat,
  mimeGambar,
  formatTanggalRingkas,
  teksAsalUsul,
} from './suratDoc';
import { lolos, renderSuratHtml } from './suratHtml';
import type { IsiSurat, KopSurat } from './suratDoc';

describe('isianSurat', () => {
  it('meneruskan nilai yang berarti apa adanya', () => {
    expect(isianSurat('PNS')).toBe('PNS');
    expect(isianSurat('  TABEK PATAH  ')).toBe('TABEK PATAH');
  });

  it('membuang penanda umum Khanza untuk "belum diisi"', () => {
    for (const penanda of ['-', '--', '---', 'null', 'undefined', 'N/A', '0', '', '   ']) {
      expect(isianSurat(penanda)).toBe('');
    }
    expect(isianSurat(null)).toBe('');
    expect(isianSurat(undefined)).toBe('');
  });

  // Kolom wilayah memakai NAMA TABELNYA SENDIRI sebagai isian bawaan --
  // 4.332 dari 4.873 pasien di database ini. Tanpa ini, 89% surat beralamat
  // "..., KELURAHAN, KECAMATAN, KABUPATEN".
  it('membuang penanda yang berupa nama kolomnya sendiri, tanpa peduli besar kecil huruf', () => {
    expect(isianSurat('KELURAHAN', 'kelurahan')).toBe('');
    expect(isianSurat('Kecamatan', 'kecamatan')).toBe('');
    expect(isianSurat('kabupaten', 'kabupaten', 'kota')).toBe('');
  });

  it('TIDAK membuang nama sungguhan yang kebetulan mirip', () => {
    // Nama nagari/desa yang memuat kata itu tetap nama yang sah.
    expect(isianSurat('KELURAHAN BALAI GADANG', 'kelurahan')).toBe('KELURAHAN BALAI GADANG');
  });
});

describe('rakitAlamat', () => {
  it('merangkai bagian yang terisi saja', () => {
    expect(
      rakitAlamat({ alamat: 'KOTO ALAM', kelurahan: 'TABEK PATAH', kecamatan: 'SALIMPAUNG', kabupaten: 'TANAH DATAR' }),
    ).toBe('KOTO ALAM, TABEK PATAH, SALIMPAUNG, TANAH DATAR');
  });

  it('membuang bagian berpenanda -- kasus 89% pasien di database ini', () => {
    expect(
      rakitAlamat({ alamat: 'KOTO ALAM', kelurahan: 'KELURAHAN', kecamatan: 'KECAMATAN', kabupaten: 'KABUPATEN' }),
    ).toBe('KOTO ALAM');
  });

  it('mengembalikan kosong bila tidak ada satu pun bagian yang berarti', () => {
    expect(rakitAlamat({ alamat: '-', kelurahan: 'KELURAHAN', kecamatan: null, kabupaten: undefined })).toBe('');
  });
});

describe('formatTanggalSurat', () => {
  it('menulis tanggal Indonesia dari string MariaDB', () => {
    expect(formatTanggalSurat('2026-08-06')).toBe('6 Agustus 2026');
    expect(formatTanggalSurat('2025-02-18')).toBe('18 Februari 2025');
    expect(formatTanggalSurat('2026-12-31 00:00:00')).toBe('31 Desember 2026');
  });

  // `'0000-00-00'` adalah penanda "belum" milik Khanza -- lihat §"Dua gotcha
  // koneksi". Tanpa penanganan ini ia jadi "Invalid Date" di dalam surat resmi.
  it('mengembalikan kosong untuk tanggal yang bukan tanggal', () => {
    for (const buruk of ['0000-00-00', '', '   ', 'bukan tanggal', '2026-13-01', '2026-00-10']) {
      expect(formatTanggalSurat(buruk)).toBe('');
    }
    expect(formatTanggalSurat(null)).toBe('');
  });
});

describe('formatUmurSurat', () => {
  it('memanjangkan singkatan sttsumur Khanza', () => {
    expect(formatUmurSurat(4, 'Bl')).toBe('4 Bulan');
    expect(formatUmurSurat(56, 'Th')).toBe('56 Tahun');
    expect(formatUmurSurat(12, 'Hr')).toBe('12 Hari');
  });

  it('meneruskan satuan tak dikenal apa adanya alih-alih menebak', () => {
    expect(formatUmurSurat(3, 'Xx')).toBe('3 Xx');
  });

  it('mengembalikan kosong untuk umur yang tidak ada', () => {
    expect(formatUmurSurat(null, 'Th')).toBe('');
    expect(formatUmurSurat(undefined, 'Th')).toBe('');
    expect(formatUmurSurat(-1, 'Th')).toBe('');
  });
});

describe('jenisKelaminLengkap', () => {
  it('memetakan enum Khanza', () => {
    expect(jenisKelaminLengkap('L')).toBe('Laki-Laki');
    expect(jenisKelaminLengkap('P')).toBe('Perempuan');
  });
  it('kosong bila tidak dikenali -- barisnya lalu dibuang dari surat', () => {
    expect(jenisKelaminLengkap('')).toBe('');
    expect(jenisKelaminLengkap(null)).toBe('');
  });
});

describe('barisTerisi', () => {
  it('membuang baris yang nilainya kosong supaya surat tidak mencetak "Pekerjaan : "', () => {
    const hasil = barisTerisi([
      { label: 'Nama Pasien', nilai: 'BUDI CONTOH PRATAMA' },
      { label: 'Pekerjaan', nilai: '' },
      { label: 'Umur', nilai: '4 Bulan' },
    ]);
    expect(hasil.map((b) => b.label)).toEqual(['Nama Pasien', 'Umur']);
  });
});

describe('namaBerkasSurat', () => {
  it('menyertakan nama pasien supaya berkas masih dikenali berbulan kemudian', () => {
    expect(namaBerkasSurat('sakit', 'SITI CONTOH')).toBe('Surat-Keterangan-Sakit-SITI-CONTOH.pdf');
    expect(namaBerkasSurat('sehat', 'Budi')).toBe('Surat-Keterangan-Sehat-Budi.pdf');
  });

  // Ini nama TAMPILAN, tapi tetap dibersihkan: nama pasien adalah ketikan bebas
  // petugas, dan pemisah lintasan di dalamnya tidak boleh ikut ke mana pun.
  it('membuang karakter yang bukan huruf/angka', () => {
    expect(namaBerkasSurat('sakit', '../../etc/passwd')).toBe('Surat-Keterangan-Sakit-etcpasswd.pdf');
    expect(namaBerkasSurat('sakit', 'A/B\\C:D*E?F"G<H>I|J')).toBe('Surat-Keterangan-Sakit-ABCDEFGHIJ.pdf');
  });

  it('tetap menghasilkan nama sah bila nama pasien tidak menyisakan apa pun', () => {
    expect(namaBerkasSurat('sehat', '???')).toBe('Surat-Keterangan-Sehat.pdf');
  });
});

describe('lolos (pelolosan HTML)', () => {
  it('meloloskan kelima karakter yang bisa keluar dari teks maupun atribut', () => {
    expect(lolos(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('meloloskan & lebih dulu supaya tidak berlipat', () => {
    expect(lolos('&lt;')).toBe('&amp;lt;');
  });
});

const KOP: KopSurat = {
  namaRs: 'RS CONTOH SEJAHTERA & APOTEK CONTOH',
  alamatRs: 'Jalan Contoh No. 1, Kecamatan Contoh',
  kotaRs: 'Kabupaten Contoh',
  propinsiRs: 'Provinsi Contoh',
  kontakRs: '0800000000',
  emailRs: 'contoh@contoh.id',
  logoDataUri: '',
};

/** Bentuk PALING POLOS: tanpa logo, tanpa QR -- yang harus tetap sah. */
const POLOS = { catatanKaki: '', qrDataUri: '' };

const SAKIT: Extract<IsiSurat, { jenis: 'sakit' }> = {
  jenis: 'sakit',
  noSurat: 'SKS20260806001',
  namaPasien: 'BUDI CONTOH PRATAMA',
  noRm: '000001',
  identitas: [
    { label: 'Nama Pasien', nilai: 'BUDI CONTOH PRATAMA' },
    { label: 'Umur', nilai: '4 Bulan' },
    { label: 'Pekerjaan', nilai: '' },
  ],
  lamaSakit: '1 (Satu)',
  tanggalAwal: '6 Agustus 2026',
  tanggalAkhir: '8 Agustus 2026',
  diagnosa: '',
  namaDokter: 'dr. Contoh Utama',
  kdDokter: 'DR001',
  tanggalSurat: '6 Agustus 2026',
  tanggalRingkas: '06-08-2026',
};

describe('renderSuratHtml', () => {
  it('memuat judul, nomor surat, dan kop rumah sakit', () => {
    const html = renderSuratHtml(SAKIT, KOP, POLOS);
    expect(html).toContain('SURAT KETERANGAN SAKIT');
    expect(html).toContain('SKS20260806001');
    expect(html).toContain('RS CONTOH SEJAHTERA &amp; APOTEK CONTOH');
    expect(html).toContain('dr. Contoh Utama');
  });

  it('membuang baris identitas yang kosong', () => {
    const html = renderSuratHtml(SAKIT, KOP, POLOS);
    expect(html).toContain('Umur');
    expect(html).not.toContain('Pekerjaan');
  });

  // Nama pasien adalah ketikan bebas petugas pendaftaran -- sumber yang sama
  // yang memaksa substitusi template satu lintasan. Di sini bahayanya elemen
  // yang menyusup ke halaman yang dirender Chromium.
  it('meloloskan nama pasien sehingga HTML di dalamnya tidak pernah jadi elemen', () => {
    const jahat = { ...SAKIT, namaPasien: '<script>x</script>', identitas: [{ label: 'Nama Pasien', nilai: '<script>x</script>' }], diagnosa: 'A00 Kolera' };
    const html = renderSuratHtml(jahat, KOP, POLOS);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('TIDAK mencetak blok diagnosa saat kosong, dan mencetaknya saat ada', () => {
    expect(renderSuratHtml(SAKIT, KOP, POLOS)).not.toContain('Diagnosa');
    const dengan = renderSuratHtml({ ...SAKIT, diagnosa: 'J06.9 ISPA' }, KOP, POLOS);
    expect(dengan).toContain('Diagnosa');
    expect(dengan).toContain('J06.9 ISPA');
    expect(dengan).toContain('memberi ijin');
  });

  it('surat sehat menyebut kesimpulan dan buta warna hanya bila tercatat', () => {
    const dasar = {
      jenis: 'sehat' as const,
      noSurat: '',
      namaPasien: 'SITI CONTOH',
      noRm: '000002',
      identitas: [{ label: 'Nama', nilai: 'SITI CONTOH' }],
      kesimpulan: '',
      butaWarna: '',
      keperluan: '',
      namaDokter: 'dr. Contoh Utama',
      kdDokter: 'DR001',
      tanggalSurat: '6 Agustus 2026',
      tanggalRingkas: '06-08-2026',
    };
    const polos = renderSuratHtml(dasar, KOP, POLOS);
    expect(polos).toContain('SEHAT');
    expect(polos).not.toContain('buta warna');
    expect(polos).toContain('sesuai keperluan');

    const lengkap = renderSuratHtml(
      { ...dasar, kesimpulan: 'Sehat', butaWarna: 'Tidak', keperluan: 'melamar pekerjaan' },
      KOP,
      POLOS,
    );
    expect(lengkap).toContain('TIDAK BUTA WARNA');
    expect(lengkap).toContain('melamar pekerjaan');
  });

  it('menulis catatan kaki asal-usul dengan baris baru jadi <br>', () => {
    const html = renderSuratHtml(SAKIT, KOP, { catatanKaki: 'Baris satu\nBaris dua', qrDataUri: '' });
    expect(html).toContain('Baris satu<br>Baris dua');
  });

  // Logo dan QR sama-sama boleh tidak ada, dan surat tetap harus utuh: rumah
  // sakit yang belum mengunggah logo, atau QR yang gagal dibuat, tidak boleh
  // berarti surat pasien batal terbit.
  it('tetap menghasilkan surat utuh tanpa logo dan tanpa QR', () => {
    const html = renderSuratHtml(SAKIT, KOP, POLOS);
    expect(html).not.toContain('<img');
    // Diperiksa pada ATRIBUTNYA, bukan pada seluruh halaman: kata "berlogo"
    // selalu ada di dalam blok <style> sebagai nama kelas, jadi asersi yang
    // menyapu seluruh HTML tidak akan pernah gagal walau kelasnya salah pasang.
    expect(html).toContain('class="kop"');
    expect(html).toContain('SURAT KETERANGAN SAKIT');
    expect(html).toContain('Dokter Pemeriksa,');
  });

  it('memasang logo di kop beserta penanda kelasnya saat ada', () => {
    const html = renderSuratHtml(SAKIT, { ...KOP, logoDataUri: 'data:image/png;base64,AAAA' }, POLOS);
    expect(html).toContain('class="kop berlogo"');
    expect(html).toContain('<img class="logo" src="data:image/png;base64,AAAA"');
  });

  // Diperiksa sebagai URUTAN, bukan sekadar keberadaan -- versi pertama memuat
  // QR-nya persis seperti ini tapi menaruhnya di pojok kiri bawah halaman, dan
  // asersi "ada gambarnya" lolos sepenuhnya. Yang menentukan QR ini terbaca
  // sebagai tanda tangan elektronik adalah letaknya: di ruang tanda tangan,
  // antara "Dokter Pemeriksa," dan nama dokter, mengikuti posisi elemen di
  // rptSuratSakit5.jrxml.
  it('menaruh QR di ruang tanda tangan, antara "Pemeriksa" dan nama dokter', () => {
    const html = renderSuratHtml(SAKIT, KOP, { catatanKaki: '', qrDataUri: 'data:image/png;base64,BBBB' });
    const pemeriksa = html.indexOf('Dokter Pemeriksa,');
    const qr = html.indexOf('alt="Kode QR pengesahan"');
    const dokter = html.indexOf('dr. Contoh Utama');
    expect(pemeriksa).toBeGreaterThan(-1);
    expect(qr).toBeGreaterThan(pemeriksa);
    expect(dokter).toBeGreaterThan(qr);
    expect(html).toContain('Pindai QR untuk memeriksa keabsahannya.');
    // Ruang tanda tangan basah digantikan QR-nya, tidak ditumpuk.
    expect(html).not.toContain('class="ruang"');
  });

  // Kebalikannya, dan ini yang menjaga surat tetap bisa ditandatangani tangan
  // bila QR-nya gagal dibuat: ruangnya harus kembali.
  it('mengembalikan ruang tanda tangan saat QR tidak ada', () => {
    const html = renderSuratHtml(SAKIT, KOP, POLOS);
    expect(html).toContain('class="ruang"');
    expect(html).not.toContain('Pindai QR');
  });

  // Data URI ikut dilolos seperti nilai lain. Alfabet base64 tidak memuat satu
  // pun karakter yang dilolos, jadi ini TIDAK boleh merusak gambarnya --
  // pelolosannya murni pagar bila suatu saat nilainya datang dari tempat lain.
  it('meloloskan data URI tanpa merusaknya', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo+/=';
    const html = renderSuratHtml(SAKIT, { ...KOP, logoDataUri: uri }, POLOS);
    expect(html).toContain(`src="${uri}"`);
  });
});

describe('mimeGambar', () => {
  const bungkus = (...awal: number[]) => new Uint8Array([...awal, ...new Array(12).fill(0)]);

  it('mengenali jenis gambar dari isinya, bukan dari nama kolom', () => {
    expect(mimeGambar(bungkus(0x89, 0x50, 0x4e, 0x47))).toBe('image/png');
    expect(mimeGambar(bungkus(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(mimeGambar(bungkus(0x47, 0x49, 0x46, 0x38))).toBe('image/gif');
    expect(mimeGambar(bungkus(0x42, 0x4d))).toBe('image/bmp');
  });

  it('mengenali WebP yang penandanya terpisah dua bagian', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(mimeGambar(webp)).toBe('image/webp');
    // RIFF tanpa WEBP adalah wadah lain (mis. WAV) -- bukan gambar.
    const riffLain = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(mimeGambar(riffLain)).toBeNull();
  });

  // Menebak "image/png" untuk isi tak dikenal menghasilkan data URI yang
  // berbohong, dan yang muncul bukan galat melainkan kop tanpa logo.
  it('mengembalikan null alih-alih menebak', () => {
    expect(mimeGambar(bungkus(0x00, 0x01, 0x02))).toBeNull();
    expect(mimeGambar(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(mimeGambar(new Uint8Array())).toBeNull();
  });
});

describe('formatTanggalRingkas', () => {
  it('memakai bentuk dd-mm-YYYY milik Khanza, bukan bentuk yang dibaca manusia', () => {
    expect(formatTanggalRingkas('2026-08-06')).toBe('06-08-2026');
    expect(formatTanggalRingkas('2026-12-31 08:30:00')).toBe('31-12-2026');
  });

  it('mengembalikan kosong untuk penanda "belum" milik Khanza', () => {
    expect(formatTanggalRingkas('0000-00-00')).toBe('');
    expect(formatTanggalRingkas(null)).toBe('');
    expect(formatTanggalRingkas('')).toBe('');
  });
});

describe('teksAsalUsul', () => {
  // Susunannya diambil dari SuratSakit.java. Menyimpang satu kata pun membuat
  // QR di sini dan QR yang dicetak Khanza berisi teks berbeda untuk surat yang
  // sama, dan membandingkan keduanya berhenti membuktikan apa pun.
  it('mengikuti susunan parameter finger milik Khanza', () => {
    expect(teksAsalUsul(KOP, SAKIT)).toBe(
      'Dikeluarkan di RS CONTOH SEJAHTERA & APOTEK CONTOH, Kabupaten/Kota Kabupaten Contoh\n' +
        'Ditandatangani secara elektronik oleh dr. Contoh Utama\n' +
        'ID DR001\n' +
        '06-08-2026',
    );
  });

  it('membuang baris yang datanya tidak ada, bukan mencetak label menggantung', () => {
    const teks = teksAsalUsul({ ...KOP, kotaRs: '' }, { ...SAKIT, kdDokter: '', tanggalRingkas: '' });
    expect(teks).toBe(
      'Dikeluarkan di RS CONTOH SEJAHTERA & APOTEK CONTOH\n' +
        'Ditandatangani secara elektronik oleh dr. Contoh Utama',
    );
    expect(teks).not.toContain('ID ');
    expect(teks).not.toContain('Kabupaten/Kota');
  });

  // QR mengesahkan SIAPA YANG MENERBITKAN, bukan siapa yang disebut. Nama
  // pasien memang tercetak besar di badan surat, tapi bentuk yang terbaca mesin
  // membuat pemanenan borongan jadi murah -- dan Khanza pun tidak memuatnya.
  it('tidak pernah memuat data pasien', () => {
    const teks = teksAsalUsul(KOP, SAKIT);
    expect(teks).not.toContain(SAKIT.namaPasien);
    expect(teks).not.toContain(SAKIT.noRm);
    expect(teks).not.toContain(SAKIT.noSurat);
  });
});
