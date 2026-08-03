import {
  parseWaAddress,
  isIndividualAddress,
  isKnownNonIndividualAddress,
  isGroupAddress,
  isLidAddress,
  isPhoneLike,
  phoneFromAddress,
} from './waAddress';

/** LID sungguhan yang ditangkap dari sesi produksi saat bug ini ditemukan. */
const LID_NYATA = '280925422235727@lid';
const CUS_NYATA = '6282283082916@c.us';

describe('parseWaAddress', () => {
  it('memisahkan user dan server', () => {
    expect(parseWaAddress(CUS_NYATA)).toEqual({ user: '6282283082916', server: 'c.us' });
    expect(parseWaAddress(LID_NYATA)).toEqual({ user: '280925422235727', server: 'lid' });
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
    expect(isGroupAddress('120363402118136446@g.us')).toBe(true);
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
    expect(phoneFromAddress(CUS_NYATA)).toBe('6282283082916');
  });

  it('TIDAK PERNAH memperlakukan bagian user sebuah LID sebagai nomor telepon', () => {
    // 280925422235727 itu 15 digit -- lolos pemeriksaan bentuk angka apa pun.
    // Kalau diambil sebagai nomor, balasan terkirim ke nomor asing, daftar
    // tolak tercatat atas nomor yang salah, dan kuota nomor lain yang termakan.
    expect(isPhoneLike('280925422235727')).toBe(true);
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
