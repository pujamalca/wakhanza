import {
  ACK_DEVICE,
  ACK_ERROR,
  ACK_PENDING,
  ACK_PLAYED,
  ACK_READ,
  ACK_SERVER,
  ackBolehMenimpa,
  isTingkatAck,
  labelAck,
  sudahSampai,
} from './waAck';

describe('isTingkatAck', () => {
  it('menerima keenam tingkat yang dikenal', () => {
    for (const t of [ACK_ERROR, ACK_PENDING, ACK_SERVER, ACK_DEVICE, ACK_READ, ACK_PLAYED]) {
      expect(isTingkatAck(t)).toBe(true);
    }
  });

  it('MENOLAK tingkat yang belum dikenal, bukan menyimpannya apa adanya', () => {
    // Tingkat baru dari WhatsApp yang lolos ke database akan tampil di dashboard
    // sebagai angka tanpa keterangan -- lebih buruk daripada kolom kosong, yang
    // sudah punya arti benar sendiri ("belum ada kabar").
    expect(isTingkatAck(5)).toBe(false);
    expect(isTingkatAck(-2)).toBe(false);
    expect(isTingkatAck('3')).toBe(false);
    expect(isTingkatAck(null)).toBe(false);
    expect(isTingkatAck(undefined)).toBe(false);
  });
});

describe('ackBolehMenimpa', () => {
  it('tingkat yang lebih maju boleh menimpa', () => {
    expect(ackBolehMenimpa(ACK_READ, ACK_DEVICE)).toBe(true);
    expect(ackBolehMenimpa(ACK_DEVICE, ACK_SERVER)).toBe(true);
  });

  it('nilai pertama selalu boleh', () => {
    expect(ackBolehMenimpa(ACK_SERVER, null)).toBe(true);
    expect(ackBolehMenimpa(ACK_SERVER, undefined)).toBe(true);
  });

  it('tingkat yang lebih rendah DITOLAK', () => {
    // Event ack tidak dijamin berurutan. Tanpa penjaga ini, pesan yang sudah
    // terbukti DIBACA bisa turun kembali jadi "sampai ke server" hanya karena
    // event lama menyusul -- konfirmasi yang mundur sendiri di depan staf.
    expect(ackBolehMenimpa(ACK_SERVER, ACK_READ)).toBe(false);
    expect(ackBolehMenimpa(ACK_DEVICE, ACK_READ)).toBe(false);
  });

  it('tingkat yang sama tidak ditulis ulang', () => {
    expect(ackBolehMenimpa(ACK_READ, ACK_READ)).toBe(false);
  });

  it('ACK_ERROR SELALU boleh menimpa, walau angkanya paling rendah', () => {
    // -1 bukan tingkat yang lebih rendah melainkan kabar bahwa pesannya gagal di
    // sisi WhatsApp SESUDAH pengiriman dianggap berhasil. Menyembunyikannya
    // karena angkanya kebetulan terkecil berarti membuang satu-satunya
    // pemberitahuan kegagalan yang datang setelah status sudah `sent`.
    expect(ackBolehMenimpa(ACK_ERROR, ACK_READ)).toBe(true);
    expect(ackBolehMenimpa(ACK_ERROR, ACK_PLAYED)).toBe(true);
  });

  it('ACK_ERROR tidak ditulis dua kali', () => {
    expect(ackBolehMenimpa(ACK_ERROR, ACK_ERROR)).toBe(false);
  });
});

describe('labelAck', () => {
  it('membedakan perorangan dari GRUP, dan bedanya bukan kosmetik', () => {
    // Di perorangan ACK_DEVICE = sampai ke satu HP; di grup = sampai ke SELURUH
    // anggota, klaim yang jauh lebih kuat. Menyamakan kalimatnya membuat staf
    // salah menyimpulkan ke dua arah.
    expect(labelAck(ACK_DEVICE, false)).toBe('Sampai ke HP penerima');
    expect(labelAck(ACK_DEVICE, true)).toBe('Sampai ke semua anggota');
    expect(labelAck(ACK_READ, false)).toBe('Dibaca');
    expect(labelAck(ACK_READ, true)).toBe('Dibaca semua anggota');
  });

  it('kosong TIDAK berbunyi "tidak sampai"', () => {
    // Ack cuma tiba selama sesi yang mengirimnya hidup, jadi pesan sebelum
    // restart worker sering tidak pernah punya kabarnya walau benar-benar
    // diterima. Kalimat "belum sampai" akan membuat staf menelepon pasien yang
    // sudah membaca pesannya.
    expect(labelAck(null)).toBe('Belum ada kabar');
    expect(labelAck(undefined)).toBe('Belum ada kabar');
  });

  it('tiap tingkat yang dikenal punya keterangannya sendiri', () => {
    const semua = [ACK_ERROR, ACK_PENDING, ACK_SERVER, ACK_DEVICE, ACK_READ, ACK_PLAYED].map((t) => labelAck(t));
    expect(new Set(semua).size).toBe(semua.length);
    expect(semua).not.toContain('Belum ada kabar');
  });
});

describe('sudahSampai', () => {
  it('server saja BELUM membuktikan sampai ke penerima', () => {
    // Inti seluruh fitur ini: `status = sent` setara ACK_SERVER, dan kiriman ke
    // JID grup yang tidak ada pun mencapainya.
    expect(sudahSampai(ACK_SERVER)).toBe(false);
    expect(sudahSampai(ACK_PENDING)).toBe(false);
    expect(sudahSampai(ACK_ERROR)).toBe(false);
  });

  it('device ke atas sudah membuktikan', () => {
    expect(sudahSampai(ACK_DEVICE)).toBe(true);
    expect(sudahSampai(ACK_READ)).toBe(true);
    expect(sudahSampai(ACK_PLAYED)).toBe(true);
  });

  it('kosong bukan bukti apa-apa', () => {
    expect(sudahSampai(null)).toBe(false);
  });
});
