import {
  bacaJamRekap,
  tulisJamRekap,
  hariRekap,
  bacaSlotRekap,
  tulisSlotRekap,
  tulisPenandaSlot,
  slotJatuhTempo,
  type JamRekap,
} from './rekapJadwal';

/** Pukul HH:MM pada 13 Agustus 2026 (Kamis). */
const pada = (jam: number, menit = 0) => new Date(2026, 7, 13, jam, menit, 0, 0);

describe('bacaJamRekap', () => {
  it('menerima bentuk yang wajar diketik staf', () => {
    expect(bacaJamRekap('13:00')).toEqual({ jam: 13, menit: 0 });
    expect(bacaJamRekap('9:5')).toEqual({ jam: 9, menit: 5 });
    expect(bacaJamRekap(' 19.30 ')).toEqual({ jam: 19, menit: 30 });
  });

  it('menolak jam yang tidak ada dalam sehari', () => {
    // 24:00 ditolak: menerimanya berarti jadwal yang tidak pernah jatuh tempo.
    expect(bacaJamRekap('24:00')).toBeNull();
    expect(bacaJamRekap('13:60')).toBeNull();
    expect(bacaJamRekap('pagi')).toBeNull();
    expect(bacaJamRekap('')).toBeNull();
    expect(bacaJamRekap(null)).toBeNull();
  });
});

describe('bacaSlotRekap', () => {
  it('membaca daftar dan mengurutkannya naik', () => {
    expect(bacaSlotRekap('19:30,13:00')).toEqual([
      { jam: 13, menit: 0 },
      { jam: 19, menit: 30 },
    ]);
  });

  it('membuang duplikat', () => {
    // Duplikat membuat satu slot dinilai dua kali oleh slotJatuhTempo().
    expect(bacaSlotRekap('13:00,13:00,13.00')).toEqual([{ jam: 13, menit: 0 }]);
  });

  it('membuang yang tidak sah TANPA menggugurkan sisanya', () => {
    // Satu salah ketik di antara tiga jam tidak boleh mematikan ketiganya.
    expect(bacaSlotRekap('13:00,pagi,19:30')).toEqual([
      { jam: 13, menit: 0 },
      { jam: 19, menit: 30 },
    ]);
  });

  it('kosong untuk masukan kosong', () => {
    expect(bacaSlotRekap('')).toEqual([]);
    expect(bacaSlotRekap(null)).toEqual([]);
    expect(bacaSlotRekap(',,')).toEqual([]);
  });

  it('bolak-balik tanpa berubah', () => {
    const teks = '08:15,13:00,19:30';
    expect(tulisSlotRekap(bacaSlotRekap(teks))).toBe(teks);
  });
});

describe('slotJatuhTempo', () => {
  const slots = bacaSlotRekap('13:00,19:30');

  it('belum ada slot yang lewat -> null', () => {
    expect(slotJatuhTempo(pada(12, 59), slots, null)).toBeNull();
  });

  it('tepat pada slotnya sudah dihitung lewat', () => {
    expect(slotJatuhTempo(pada(13, 0), slots, null)).toEqual({ jam: 13, menit: 0 });
  });

  it('tanpa penanda, slot pertama berbunyi', () => {
    expect(slotJatuhTempo(pada(13, 5), slots, null)).toEqual({ jam: 13, menit: 0 });
  });

  it('penanda slot pertama menahan slot pertama', () => {
    const p = tulisPenandaSlot('2026-08-13', { jam: 13, menit: 0 });
    expect(slotJatuhTempo(pada(15, 0), slots, p)).toBeNull();
  });

  it('penanda slot pertama TIDAK menahan slot kedua', () => {
    // Inti seluruh perubahan: penanda bertanggal saja akan mengembalikan null di
    // sini, sehingga rekap 19:30 tidak pernah berangkat.
    const p = tulisPenandaSlot('2026-08-13', { jam: 13, menit: 0 });
    expect(slotJatuhTempo(pada(19, 35), slots, p)).toEqual({ jam: 19, menit: 30 });
  });

  it('penanda slot kedua menahan keduanya', () => {
    const p = tulisPenandaSlot('2026-08-13', { jam: 19, menit: 30 });
    expect(slotJatuhTempo(pada(20, 0), slots, p)).toBeNull();
  });

  it('penanda kemarin tidak menahan apa pun hari ini', () => {
    const p = tulisPenandaSlot('2026-08-12', { jam: 19, menit: 30 });
    expect(slotJatuhTempo(pada(13, 5), slots, p)).toEqual({ jam: 13, menit: 0 });
  });

  it('worker mati seharian -> HANYA slot terakhir, bukan keduanya', () => {
    // Isinya dihitung saat kirim, jadi mengejar slot terlewat menghasilkan dua
    // pesan yang isinya nyaris sama persis.
    expect(slotJatuhTempo(pada(20, 0), slots, null)).toEqual({ jam: 19, menit: 30 });
  });

  it('menghapus slot yang sudah berbunyi tidak membangkitkan kiriman lama', () => {
    // Staf menghapus 19:30 sesudah ia berbunyi, menyisakan 13:00. Dengan
    // perbandingan `!==` alih-alih `>`, rekap 13:00 akan berangkat sekali lagi.
    const p = tulisPenandaSlot('2026-08-13', { jam: 19, menit: 30 });
    const sisa = bacaSlotRekap('13:00');
    expect(slotJatuhTempo(pada(20, 0), sisa, p)).toBeNull();
  });

  it('penanda bentuk LAMA (tanggal saja) diperlakukan sebagai hari lain', () => {
    // Baris peninggalan dari sebelum slot ada. Kalau tanggalnya hari ini, ia
    // tidak punya slot yang bisa dibaca -> gagal AMAN (tidak mengirim).
    expect(slotJatuhTempo(pada(20, 0), slots, '2026-08-12')).toEqual({ jam: 19, menit: 30 });
    expect(slotJatuhTempo(pada(20, 0), slots, '2026-08-13')).toBeNull();
  });

  it('penanda tidak terbaca pada hari ini -> gagal AMAN', () => {
    // Mengirim ulang daftar pasien lebih mahal daripada satu rekap yang terlewat.
    expect(slotJatuhTempo(pada(20, 0), slots, '2026-08-13 entahlah')).toBeNull();
  });

  it('tanpa slot sama sekali -> null', () => {
    expect(slotJatuhTempo(pada(23, 0), [], null)).toBeNull();
  });

  it('satu slot berperilaku sama dengan rekap harian yang sudah ada', () => {
    const satu: JamRekap[] = bacaSlotRekap('21:00');
    expect(slotJatuhTempo(pada(20, 59), satu, null)).toBeNull();
    expect(slotJatuhTempo(pada(21, 0), satu, null)).toEqual({ jam: 21, menit: 0 });
    const p = tulisPenandaSlot('2026-08-13', { jam: 21, menit: 0 });
    expect(slotJatuhTempo(pada(23, 59), satu, p)).toBeNull();
  });
});

describe('hariRekap', () => {
  it('offset 0 = hari ini, 1 = kemarin', () => {
    expect(hariRekap(pada(21), 0)).toBe('2026-08-13');
    expect(hariRekap(pada(21), 1)).toBe('2026-08-12');
  });

  it('menyeberangi pergantian bulan', () => {
    expect(hariRekap(new Date(2026, 8, 1, 6, 0), 1)).toBe('2026-08-31');
  });

  it('offset negatif dianggap 0', () => {
    expect(hariRekap(pada(21), -3)).toBe('2026-08-13');
  });
});

describe('tulisJamRekap', () => {
  it('selalu dua digit', () => {
    expect(tulisJamRekap({ jam: 9, menit: 5 })).toBe('09:05');
  });
});
