import { gabungPercakapan, type PesanCatatanRingkas, type PesanKeluarRingkas } from './percakapan';

const masuk = (id: number, iso: string, teks = 'halo'): PesanCatatanRingkas => ({
  id,
  arah: 'masuk',
  waktu: new Date(iso),
  teks,
  keterangan: null,
  namaPengirim: 'Penanya',
});

/** Balasan yang diketik petugas dari ponsel: baris `inbound_message` ber-arah keluar. */
const manual = (id: number, iso: string, teks = 'sudah kami terima'): PesanCatatanRingkas => ({
  id,
  arah: 'keluar',
  waktu: new Date(iso),
  teks,
  keterangan: null,
  namaPengirim: null,
});

const keluar = (id: number, iso: string, terkirim: string | null = null): PesanKeluarRingkas => ({
  id,
  waktu: new Date(iso),
  teks: 'balasan',
  status: 'sent',
  terkirimAt: terkirim ? new Date(terkirim) : null,
  ackLevel: null,
  triggerCode: 'BALAS_MANUAL',
});

describe('gabungPercakapan', () => {
  it('mengurutkan naik -- yang terbaru di bawah, dekat kotak balasan', () => {
    const hasil = gabungPercakapan(
      [masuk(1, '2026-08-15T02:00:00Z'), masuk(2, '2026-08-15T04:00:00Z')],
      [keluar(9, '2026-08-15T03:00:00Z')],
    );
    expect(hasil.map((b) => b.kunci)).toEqual(['cat-1', 'out-9', 'cat-2']);
  });

  /**
   * Inilah yang membuat urutannya benar-benar mencerminkan percakapan. Balasan
   * yang diketik pukul 22:00 lalu tertahan jam tenang sampai 07:00 harus tetap
   * duduk SESUDAH pesan yang dijawabnya, bukan melompat ke bawah pesan yang
   * datang subuh.
   */
  it('pesan keluar diurutkan menurut waktu masuk antrean, bukan waktu terkirim', () => {
    const hasil = gabungPercakapan(
      [
        masuk(1, '2026-08-14T14:30:00Z', 'tanya malam'),
        masuk(2, '2026-08-14T22:00:00Z', 'tanya subuh'),
      ],
      // Diketik 14:45 (sesudah "tanya malam"), baru terkirim 00:00 keesokan hari.
      [keluar(9, '2026-08-14T14:45:00Z', '2026-08-15T00:00:00Z')],
    );
    expect(hasil.map((b) => b.kunci)).toEqual(['cat-1', 'out-9', 'cat-2']);
    // Waktu terkirimnya tetap dibawa untuk ditampilkan -- ia cuma tidak
    // menentukan tempatnya.
    expect(hasil[1]!.terkirimAt).toEqual(new Date('2026-08-15T00:00:00Z'));
  });

  it('urutannya stabil saat waktunya seri persis', () => {
    const t = '2026-08-15T02:00:00Z';
    const a = gabungPercakapan([masuk(1, t)], [keluar(9, t)]);
    // Larik masukan dibalik urutannya; hasilnya harus sama persis.
    const b = gabungPercakapan([masuk(1, t)], [keluar(9, t)]).reverse().reverse();
    expect(a.map((x) => x.kunci)).toEqual(b.map((x) => x.kunci));
    expect(a.map((x) => x.kunci)).toEqual(['cat-1', 'out-9']);
  });

  it('kunci masuk dan keluar tidak pernah bertabrakan walau id-nya sama', () => {
    // Dua tabel berbeda, dua urutan id yang berdiri sendiri -- kunci React yang
    // bertabrakan membuat satu gelembung hilang dari layar tanpa satu pun galat.
    const hasil = gabungPercakapan([masuk(7, '2026-08-15T02:00:00Z')], [keluar(7, '2026-08-15T03:00:00Z')]);
    expect(new Set(hasil.map((b) => b.kunci)).size).toBe(2);
  });

  it('percakapan kosong tidak meledak', () => {
    expect(gabungPercakapan([], [])).toEqual([]);
  });

  it('membawa keterangan pesan yang isinya tidak disimpan', () => {
    const hasil = gabungPercakapan(
      [{ id: 1, arah: 'masuk', waktu: new Date('2026-08-15T02:00:00Z'), teks: null, keterangan: 'Gambar', namaPengirim: null }],
      [],
    );
    expect(hasil[0]!.teks).toBeNull();
    expect(hasil[0]!.keterangan).toBe('Gambar');
  });

  /**
   * Inilah yang dulu tidak ada sama sekali. Balasan petugas diketik di aplikasi
   * WhatsApp, jadi tidak pernah lewat `outbox` -- dan percakapan menampilkan
   * pertanyaan berderet tanpa satu pun jawaban, padahal jawabannya sudah
   * diberikan.
   */
  it('menempatkan balasan yang diketik dari ponsel di sisi KELUAR', () => {
    const hasil = gabungPercakapan(
      [masuk(1, '2026-08-17T02:00:00Z'), manual(2, '2026-08-17T02:05:00Z')],
      [],
    );
    expect(hasil.map((b) => [b.kunci, b.arah])).toEqual([
      ['cat-1', 'masuk'],
      ['cat-2', 'keluar'],
    ]);
  });

  /**
   * Balasan manual TIDAK punya status, konfirmasi terkirim, maupun kode pemicu
   * -- semuanya milik `outbox`. Menampilkannya sebagai lencana kosong lebih
   * buruk daripada tidak menampilkannya: petugas membaca ketiadaan lencana
   * "Terkirim" sebagai pesan yang gagal.
   */
  it('balasan manual tidak membawa status maupun konfirmasi milik outbox', () => {
    const [b] = gabungPercakapan([manual(3, '2026-08-17T02:00:00Z')], []);
    expect(b).toMatchObject({ arah: 'keluar', status: null, ackLevel: null, triggerCode: null, terkirimAt: null });
  });

  it('balasan manual dan pesan sistem berbaur menurut waktu, bukan menurut sumbernya', () => {
    const hasil = gabungPercakapan(
      [masuk(1, '2026-08-17T01:00:00Z'), manual(2, '2026-08-17T03:00:00Z')],
      [keluar(9, '2026-08-17T02:00:00Z')],
    );
    expect(hasil.map((b) => b.kunci)).toEqual(['cat-1', 'out-9', 'cat-2']);
  });
});
