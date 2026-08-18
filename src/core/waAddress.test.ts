import {
  parseWaAddress,
  isIndividualAddress,
  isKnownNonIndividualAddress,
  isGroupAddress,
  isLidAddress,
  isPhoneLike,
  phoneFromAddress,
  kunciPesanMasuk,
  idPesanKeluar,
} from './waAddress';

/**
 * BENTUK LID sebagaimana ditangkap dari sesi produksi saat bug ini ditemukan.
 * Digitnya sintetis: nilai aslinya mengidentifikasi satu pengguna WhatsApp
 * yang nyata, dan repo ini publik. Yang perlu dijaga uji ini adalah BENTUKnya
 * -- 15 digit, jadi ia lolos pemeriksaan "8-15 digit" apa pun sementara ia
 * bukan nomor telepon -- dan bentuk itu tidak berubah sedikit pun.
 */
const LID_NYATA = '205000000000015@lid';
const CUS_NYATA = '6281200000016@c.us';

describe('parseWaAddress', () => {
  it('memisahkan user dan server', () => {
    expect(parseWaAddress(CUS_NYATA)).toEqual({ user: '6281200000016', server: 'c.us' });
    expect(parseWaAddress(LID_NYATA)).toEqual({ user: '205000000000015', server: 'lid' });
  });

  it('menolak bentuk yang tidak utuh', () => {
    for (const aneh of ['', null, undefined, '628123', '@c.us', '628123@']) {
      expect(parseWaAddress(aneh)).toBeNull();
    }
  });
});

describe('isIndividualAddress', () => {
  it('menerima obrolan perorangan, termasuk yang sudah pindah ke LID', () => {
    // Inilah baris yang dulu tidak ada. Tanpa `lid`, setiap pesan dari nomor
    // yang WhatsApp pindahkan hilang tanpa jejak.
    expect(isIndividualAddress(CUS_NYATA)).toBe(true);
    expect(isIndividualAddress(LID_NYATA)).toBe(true);
  });

  it('menolak grup, siaran, saluran, dan server yang belum dikenal', () => {
    for (const bukan of ['12036304@g.us', 'status@broadcast', '1234@newsletter', '1234@server-baru']) {
      expect(isIndividualAddress(bukan)).toBe(false);
    }
  });
});

describe('isGroupAddress', () => {
  it('mengenali grup, dan HANYA grup', () => {
    expect(isGroupAddress('120363000000000000@g.us')).toBe(true);
    expect(isGroupAddress('6281234567890-1614840000@g.us')).toBe(true);
  });

  it('status dan saluran BUKAN grup, walau sama-sama bukan perorangan', () => {
    // Pembedaan ini yang menentukan apa yang dicatat ke inbound_message: pesan
    // grup harus masuk daftar, sementara status dari setiap kontak akan
    // menumpuk ribuan baris sehari yang tidak seorang pun cari.
    expect(isGroupAddress('status@broadcast')).toBe(false);
    expect(isGroupAddress('1234@newsletter')).toBe(false);
  });

  it('alamat perorangan bukan grup', () => {
    expect(isGroupAddress(CUS_NYATA)).toBe(false);
    expect(isGroupAddress(LID_NYATA)).toBe(false);
    expect(isGroupAddress(null)).toBe(false);
  });
});

describe('isKnownNonIndividualAddress', () => {
  it('mengenali lalu lintas latar yang wajar (status kontak, grup, saluran)', () => {
    // Nomor rumah sakit menerima status dari SETIAP kontaknya. Kalau ini
    // dicatat sebagai peringatan, peringatan berhenti berarti apa-apa.
    for (const rutin of ['status@broadcast', '12036304@g.us', '1234@newsletter']) {
      expect(isKnownNonIndividualAddress(rutin)).toBe(true);
    }
  });

  it('TIDAK menganggap server asing sebagai rutin -- justru itu yang harus berisik', () => {
    expect(isKnownNonIndividualAddress('1234@server-baru')).toBe(false);
    // Alamat perorangan bukan urusan fungsi ini.
    expect(isKnownNonIndividualAddress(LID_NYATA)).toBe(false);
    expect(isKnownNonIndividualAddress(CUS_NYATA)).toBe(false);
  });
});

describe('phoneFromAddress', () => {
  it('mengambil nomor dari alamat c.us', () => {
    expect(phoneFromAddress(CUS_NYATA)).toBe('6281200000016');
  });

  it('TIDAK PERNAH memperlakukan bagian user sebuah LID sebagai nomor telepon', () => {
    // 205000000000015 itu 15 digit -- lolos pemeriksaan bentuk angka apa pun.
    // Kalau diambil sebagai nomor, balasan terkirim ke nomor asing, daftar
    // tolak tercatat atas nomor yang salah, dan kuota nomor lain yang termakan.
    expect(isPhoneLike('205000000000015')).toBe(true);
    expect(phoneFromAddress(LID_NYATA)).toBeNull();
    expect(isLidAddress(LID_NYATA)).toBe(true);
    expect(isLidAddress(CUS_NYATA)).toBe(false);
  });

  it('menolak user c.us yang bukan nomor', () => {
    for (const aneh of ['0812345678@c.us', 'abc@c.us', '123@c.us']) {
      expect(phoneFromAddress(aneh)).toBeNull();
    }
  });

  it('menolak grup', () => {
    expect(phoneFromAddress('12036304@g.us')).toBeNull();
  });
});

/**
 * Sampai ini ada, jalur balasan stok grup memperlakukan `_serialized` yang
 * hilang sebagai fatal lalu diam -- sehingga TIDAK SATU PUN pertanyaan dari
 * grup pernah dijawab, tanpa satu pun galat. Dua jalur lain sudah memakai
 * cadangan sejak awal; yang diuji di sini adalah bahwa ketiganya kini sepakat.
 */
describe('kunciPesanMasuk', () => {
  it('memakai _serialized bila ada', () => {
    expect(
      kunciPesanMasuk({ id: { _serialized: 'false_628@c.us_ABC' }, from: '628@c.us', timestamp: 1785806906 }),
    ).toBe('false_628@c.us_ABC');
  });

  it('jatuh ke from:timestamp saat _serialized hilang -- keadaan nyata pada pesan grup', () => {
    expect(kunciPesanMasuk({ id: {}, from: '12036@g.us', timestamp: 1785806906 })).toBe('12036@g.us:1785806906');
    expect(kunciPesanMasuk({ id: undefined, from: '12036@g.us', timestamp: 1785806906 })).toBe(
      '12036@g.us:1785806906',
    );
  });

  it('pesan yang SAMA diserahkan ulang menghasilkan kunci yang sama', () => {
    const pesan = { id: {}, from: '12036@g.us', timestamp: 1785806906 };
    expect(kunciPesanMasuk(pesan)).toBe(kunciPesanMasuk({ ...pesan }));
  });

  it('tanpa timestamp tetap menghasilkan kunci, bukan string kosong', () => {
    // Kunci kosong akan membuat UNIQUE KEY menolak baris kedua mana pun dan
    // seluruh pencatatan berhenti diam-diam.
    expect(kunciPesanMasuk({ from: '12036@g.us' })).toBe('12036@g.us:0');
  });
});

describe('idPesanKeluar', () => {
  it('memakai _serialized bila ada', () => {
    expect(idPesanKeluar({ id: { _serialized: 'true_628@c.us_ABC' } })).toBe('true_628@c.us_ABC');
  });

  /**
   * Jebakan yang TERBUKTI, bukan diperkirakan: `_serialized` adalah getter pada
   * prototipe MsgKey dan tidak ikut menyeberang lewat serialisasi puppeteer.
   * Percobaan pertama fitur konfirmasi memakai `_serialized` saja, dan
   * `wa_message_id` NULL pada setiap kiriman.
   */
  it('merakit ulang saat _serialized hilang', () => {
    expect(idPesanKeluar({ id: { fromMe: true, remote: '628123@c.us', id: 'ABC' } })).toBe('true_628123@c.us_ABC');
  });

  it('menerima remote berupa objek Wid ber-_serialized', () => {
    expect(idPesanKeluar({ id: { fromMe: true, remote: { _serialized: '628@c.us' }, id: 'X' } })).toBe('true_628@c.us_X');
  });

  it('merakit remote dari user+server saat _serialized-nya pun luruh', () => {
    expect(idPesanKeluar({ id: { fromMe: true, remote: { user: '628', server: 'c.us' }, id: 'X' } })).toBe(
      'true_628@c.us_X',
    );
  });

  it('fromMe false ikut terbaca', () => {
    expect(idPesanKeluar({ id: { fromMe: false, remote: '628@c.us', id: 'X' } })).toBe('false_628@c.us_X');
  });

  it('null saat tidak ada yang bisa diturunkan -- BUKAN kegagalan kirim', () => {
    expect(idPesanKeluar(null)).toBeNull();
    expect(idPesanKeluar({})).toBeNull();
    expect(idPesanKeluar({ id: { fromMe: true } })).toBeNull();
    expect(idPesanKeluar({ id: { remote: '628@c.us' } })).toBeNull();
  });

  it('perakitannya deterministik -- pengirim dan pendengar ack wajib sepakat', () => {
    const a = idPesanKeluar({ id: { fromMe: true, remote: { user: '628', server: 'c.us' }, id: 'X' } });
    const b = idPesanKeluar({ id: { fromMe: true, remote: '628@c.us', id: 'X' } });
    expect(a).toBe(b);
  });
});
