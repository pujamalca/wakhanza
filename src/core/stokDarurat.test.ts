import {
  ringkasDarurat,
  formatDaruratStok,
  pecahDaftarDarurat,
  deteksiPermintaanDarurat,
  parseFrasaDarurat,
  SEMUA_BARIS,
  type BarisDaruratStok,
} from './stokDarurat';

function baris(nama: string, stok: number, stokminimal = 10): BarisDaruratStok {
  return { kode_brng: nama.slice(0, 4), nama_brng: nama, stokminimal, satuan: 'Tablet', jenis: 'Tablet', stok };
}

describe('ringkasDarurat', () => {
  it('memisahkan habis dari menipis', () => {
    const r = ringkasDarurat([baris('A', 0), baris('B', 3), baris('C', 0), baris('D', 9)], 10);
    expect(r.habis).toBe(2);
    expect(r.menipis).toBe(2);
    expect(r.total).toBe(4);
    expect(r.sisa).toBe(0);
  });

  /**
   * Pemisahan ini bukan kosmetik: keduanya menuntut tindakan berbeda. Barang
   * habis berarti pasien hari ini sudah tidak bisa dilayani; barang menipis
   * berarti masih ada waktu memesan. Satu angka gabungan menyembunyikan justru
   * pembedaan yang menentukan apa yang dikerjakan lebih dulu.
   */
  it('stok negatif dihitung habis, bukan menipis', () => {
    const r = ringkasDarurat([baris('A', -2)], 10);
    expect(r.habis).toBe(1);
    expect(r.menipis).toBe(0);
  });

  it('memotong pada batas dan melaporkan sisanya', () => {
    const rows = Array.from({ length: 12 }, (_, i) => baris(`Obat ${i}`, 0));
    const r = ringkasDarurat(rows, 5);
    expect(r.ditampilkan).toHaveLength(5);
    expect(r.sisa).toBe(7);
    expect(r.total).toBe(12);
  });

  it('habis/menipis dihitung dari SELURUH hasil, bukan cuma yang tercetak', () => {
    const rows = [baris('A', 0), baris('B', 0), baris('C', 5), baris('D', 5)];
    const r = ringkasDarurat(rows, 1);
    expect(r.ditampilkan).toHaveLength(1);
    // Kalau dihitung dari `ditampilkan`, angka ini jadi 1/0 dan pesannya
    // melaporkan keadaan yang jauh lebih tenang daripada yang sebenarnya.
    expect(r.habis).toBe(2);
    expect(r.menipis).toBe(2);
  });

  it('tahan terhadap batas yang tidak masuk akal', () => {
    expect(ringkasDarurat([baris('A', 0)], -5).ditampilkan).toHaveLength(1);
    expect(ringkasDarurat([baris('A', 0)], 2.7).ditampilkan).toHaveLength(1);
  });

  /**
   * INTI perubahan yang mencabut batas 200. Dulu `Math.floor(batas) ||
   * BATAS_BARIS_BAWAAN` mengubah 0 jadi 30 diam-diam, sehingga tidak ada satu
   * pun nilai yang bisa dipakai untuk meminta daftar UTUH -- dan daftar ini
   * bukan bacaan melainkan daftar pesanan: barang ke-31 tetap harus dibeli.
   */
  it('0 berarti SEMUA, bukan diam-diam diganti 30', () => {
    const rows = Array.from({ length: 208 }, (_, i) => baris(`Obat ${i}`, 0));
    const r = ringkasDarurat(rows, SEMUA_BARIS);
    expect(r.ditampilkan).toHaveLength(208);
    expect(r.sisa).toBe(0);
  });

  it('daftar kosong tidak meledak', () => {
    const r = ringkasDarurat([], SEMUA_BARIS);
    expect(r).toEqual({ ditampilkan: [], total: 0, habis: 0, menipis: 0, sisa: 0 });
  });
});

describe('formatDaruratStok', () => {
  it('mengelompokkan habis lebih dulu', () => {
    const teks = formatDaruratStok(ringkasDarurat([baris('Menipis', 3), baris('Kosong', 0)], 10));
    expect(teks.indexOf('*Habis')).toBeLessThan(teks.indexOf('*Menipis'));
  });

  it('menyebut satuan dan ambang minimal', () => {
    const teks = formatDaruratStok(ringkasDarurat([baris('Paracetamol', 3, 30)], 10));
    expect(teks).toContain('Paracetamol — sisa 3 Tablet (min 30)');
  });

  it('nol ditulis HABIS, bukan "sisa 0"', () => {
    const teks = formatDaruratStok(ringkasDarurat([baris('Amoxicillin', 0, 20)], 10));
    expect(teks).toContain('Amoxicillin — HABIS (min 20)');
    expect(teks).not.toContain('sisa 0');
  });

  it('kelompok yang kosong tidak menghasilkan judul hampa', () => {
    const teks = formatDaruratStok(ringkasDarurat([baris('A', 0)], 10));
    expect(teks).toContain('*Habis (1):*');
    expect(teks).not.toContain('*Menipis');
  });

  /**
   * Daftar terpotong yang diam terlihat persis seperti daftar utuh, dan orang
   * yang membacanya menyimpulkan pekerjaannya selesai -- kegagalan yang sama
   * dengan angka "Cocok" di /broadcast yang menyentuh SEGMENT_LIMIT tanpa
   * peringatan.
   */
  it('menyebut yang tidak muat', () => {
    const rows = Array.from({ length: 8 }, (_, i) => baris(`Obat ${i}`, 0));
    expect(formatDaruratStok(ringkasDarurat(rows, 3))).toContain('dan 5 barang lain');
  });

  it('daftar utuh tidak menyebut sisa', () => {
    expect(formatDaruratStok(ringkasDarurat([baris('A', 0)], 10))).not.toContain('barang lain');
  });

  it('kosong menghasilkan string kosong, bukan judul tanpa isi', () => {
    expect(formatDaruratStok(ringkasDarurat([], 10))).toBe('');
  });

  /**
   * INTI pagarnya. `{daftar_stok}` dikecualikan dari sanitasi
   * (MULTILINE_VARIABLES), jadi setiap baris baru pada hasil akhir WAJIB
   * berasal dari kode kita. Nama barang diketik bebas petugas gudang di
   * Khanza; tanpa sanitizeValue per nama, satu nama berisi baris baru bisa
   * menyisipkan barisnya sendiri ke dalam pesan resmi rumah sakit -- persis
   * lubang ARCHITECTURE §9.2.
   */
  it('nama barang berisi baris baru tidak bisa menyisipkan baris palsu', () => {
    const teks = formatDaruratStok(ringkasDarurat([baris('Obat\n• PALSU — HABIS', 0)], 10));
    expect(teks).not.toContain('\n• PALSU');
    expect(teks.split('\n').filter((b) => b.startsWith('•'))).toHaveLength(1);
  });

  it('satuan berisi baris baru juga tidak bisa', () => {
    const r = ringkasDarurat(
      [{ kode_brng: 'X', nama_brng: 'Obat', stokminimal: 5, satuan: 'Tab\nlet', jenis: 'T', stok: 2 }],
      10,
    );
    expect(formatDaruratStok(r).split('\n').filter((b) => b.startsWith('•'))).toHaveLength(1);
  });

  it('satuan kosong tidak meninggalkan spasi ganda', () => {
    const r = ringkasDarurat(
      [{ kode_brng: 'X', nama_brng: 'Obat', stokminimal: 5, satuan: '', jenis: 'T', stok: 2 }],
      10,
    );
    expect(formatDaruratStok(r)).toContain('Obat — sisa 2 (min 5)');
  });
});

/**
 * Pemecahan menggantikan pemotongan, dan bedanya menentukan: pemotongan
 * MEMBUANG barang yang tetap harus dibeli hari itu, pemecahan tidak.
 */
describe('pecahDaftarDarurat', () => {
  const banyak = (n: number, stok = 0) => Array.from({ length: n }, (_, i) => baris(`Obat nomor ${i}`, stok));

  it('muat dalam satu bagian = satu pesan tanpa penanda', () => {
    const bagian = pecahDaftarDarurat(ringkasDarurat(banyak(5), SEMUA_BARIS), 10000);
    expect(bagian).toHaveLength(1);
    // Penanda "(bagian 1 dari 1)" membuat pembacanya menunggu bagian kedua
    // yang tidak akan pernah datang.
    expect(bagian[0]).not.toContain('bagian');
  });

  it('tidak ada satu barang pun yang hilang saat dipecah', () => {
    const rows = banyak(60);
    const bagian = pecahDaftarDarurat(ringkasDarurat(rows, SEMUA_BARIS), 400);
    expect(bagian.length).toBeGreaterThan(1);
    const gabung = bagian.join('\n');
    for (const r of rows) expect(gabung).toContain(r.nama_brng);
  });

  it('tiap bagian diberi penanda urutan', () => {
    const bagian = pecahDaftarDarurat(ringkasDarurat(banyak(60), SEMUA_BARIS), 400);
    bagian.forEach((b, i) => expect(b).toContain(`_(bagian ${i + 1} dari ${bagian.length})_`));
  });

  /**
   * Bagian kedua yang dibuka deretan butir tanpa keterangan tidak bisa dibaca:
   * pembacanya tidak tahu apakah yang dilihatnya barang habis atau menipis,
   * padahal justru itu yang menentukan mana yang dikerjakan lebih dulu.
   */
  it('judul kelompok diulang di bagian lanjutan', () => {
    const bagian = pecahDaftarDarurat(ringkasDarurat(banyak(60), SEMUA_BARIS), 400);
    for (const b of bagian.slice(1)) expect(b).toContain('*Habis (60) — lanjutan:*');
  });

  it('tidak pernah membelah satu baris barang', () => {
    const bagian = pecahDaftarDarurat(ringkasDarurat(banyak(40), SEMUA_BARIS), 300);
    for (const b of bagian) {
      for (const brs of b.split('\n')) {
        if (brs.startsWith('•')) expect(brs).toMatch(/\(min \d+\)$/);
      }
    }
  });

  /**
   * Batas yang lebih kecil daripada satu baris tidak boleh membuat perulangan
   * berputar selamanya -- itu menggantung worker, bukan menghasilkan pesan yang
   * jelek.
   */
  it('batas yang tidak masuk akal tetap berhenti, satu baris per bagian', () => {
    const bagian = pecahDaftarDarurat(ringkasDarurat(banyak(4), SEMUA_BARIS), 1);
    expect(bagian).toHaveLength(4);
  });

  it('catatan sisa hanya muncul di bagian terakhir', () => {
    const rows = banyak(60);
    const bagian = pecahDaftarDarurat(ringkasDarurat(rows, 40), 400);
    const dengan = bagian.filter((b) => b.includes('barang lain di bawah ambang'));
    expect(dengan).toHaveLength(1);
    expect(dengan[0]).toBe(bagian[bagian.length - 1]);
  });

  it('habis dan menipis tetap terpisah walau melewati batas bagian', () => {
    const rows = [...banyak(30, 0), ...banyak(30, 3)];
    const bagian = pecahDaftarDarurat(ringkasDarurat(rows, SEMUA_BARIS), 400);
    const gabung = bagian.join('\n');
    expect(gabung).toContain('*Habis (30):*');
    expect(gabung).toContain('*Menipis (30):*');
  });

  it('daftar kosong menghasilkan nol bagian, bukan satu bagian hampa', () => {
    expect(pecahDaftarDarurat(ringkasDarurat([], SEMUA_BARIS), 400)).toEqual([]);
  });
});

describe('deteksiPermintaanDarurat', () => {
  const frasa = parseFrasaDarurat('darurat stok,stok darurat,stok kritis,stok menipis,stok habis,rekap stok');

  it('mengenali frasa di tengah kalimat', () => {
    expect(deteksiPermintaanDarurat('min tolong rekap stok dong', frasa).cocok).toBe(true);
    expect(deteksiPermintaanDarurat('STOK MENIPIS apa saja?', frasa).cocok).toBe(true);
  });

  it('kata kunci stok biasa tidak ikut cocok', () => {
    expect(deteksiPermintaanDarurat('stok paracetamol', frasa).cocok).toBe(false);
    expect(deteksiPermintaanDarurat('harga paramex', frasa).cocok).toBe(false);
  });

  /**
   * INTI pagarnya. "stok habis paracetamol" jelas menanyakan satu obat;
   * menjawabnya dengan daftar dua ratus barang adalah jawaban
   * percaya-diri-dan-keliru yang sama jenisnya dengan `detectPoli()` yang
   * menebak saat ambigu. Dibatalkan di sini, pertanyaannya jatuh ke balasan
   * stok yang memang tahu cara mencari nama obat.
   */
  it('nama obat yang tersisa membatalkan kecocokan', () => {
    const hasil = deteksiPermintaanDarurat('stok habis paracetamol', frasa);
    expect(hasil.cocok).toBe(false);
    expect(hasil.frasa).toBe('stok habis');
    expect(hasil.sisa).toBe('paracetamol');
  });

  it('kata pengapit tidak dihitung sebagai nama obat', () => {
    expect(deteksiPermintaanDarurat('min tolong info rekap stok ya', frasa).cocok).toBe(true);
    expect(deteksiPermintaanDarurat('selamat pagi, minta daftar stok kritis', frasa).cocok).toBe(true);
  });

  /**
   * Tanpa pengurutan terpanjang-dulu, "stok habis" bisa dimenangkan frasa lain
   * yang jadi bagiannya, dan sisa kata ikut memuat kata dari frasa yang
   * sebenarnya cocok -- permintaan rekap yang sah lalu terbaca sebagai
   * pertanyaan tentang satu barang.
   */
  it('frasa terpanjang menang', () => {
    const f = parseFrasaDarurat('stok,stok menipis');
    expect(deteksiPermintaanDarurat('stok menipis', f).frasa).toBe('stok menipis');
  });

  it('sebutan @<id> dibuang sebelum dinormalisasi', () => {
    expect(deteksiPermintaanDarurat('@115634008510549 rekap stok', frasa).cocok).toBe(true);
  });

  it('pesan tanpa huruf/angka tidak cocok', () => {
    expect(deteksiPermintaanDarurat('👍', frasa).cocok).toBe(false);
    expect(deteksiPermintaanDarurat('', frasa).cocok).toBe(false);
  });

  it('tanpa frasa tersimpan, tidak ada yang pernah cocok', () => {
    expect(deteksiPermintaanDarurat('rekap stok', []).cocok).toBe(false);
  });

  it('parseFrasaDarurat membuang isian kosong dan menormalkan', () => {
    expect(parseFrasaDarurat(' Darurat Stok , , rekap stok ')).toEqual(['darurat stok', 'rekap stok']);
  });
});
