import {
  parseTarget,
  parseTargetGrup,
  parseTargetPersonal,
  tampilkanChatId,
  isChatIdValid,
} from './farmasiTarget';

describe('parseTargetGrup', () => {
  it('menerima JID grup bentuk baru, dengan maupun tanpa akhiran', () => {
    expect(parseTargetGrup('120363402118136446@g.us')).toEqual({
      ok: true,
      chatId: '120363402118136446@g.us',
      jenis: 'grup',
    });
    expect(parseTargetGrup('120363402118136446')).toEqual({
      ok: true,
      chatId: '120363402118136446@g.us',
      jenis: 'grup',
    });
  });

  it('menerima JID grup bentuk LAMA (nomor pembuat-waktu dibuat)', () => {
    // Grup apotek yang sudah dipakai bertahun-tahun justru berbentuk ini --
    // menolaknya berarti menolak grup yang paling mungkin ingin dipasang.
    expect(parseTargetGrup('6281234567890-1614840000@g.us')).toEqual({
      ok: true,
      chatId: '6281234567890-1614840000@g.us',
      jenis: 'grup',
    });
  });

  it('membuang spasi di tepi -- menempel dari clipboard hampir selalu membawanya', () => {
    expect(parseTargetGrup('  120363402118136446@g.us \n')).toMatchObject({ ok: true });
  });

  it('akhiran @g.us dikenali tanpa peduli huruf besar-kecil', () => {
    expect(parseTargetGrup('120363402118136446@G.US')).toMatchObject({ ok: true, chatId: '120363402118136446@g.us' });
  });

  it('TAUTAN UNDANGAN ditolak dengan menyebut jalan keluarnya', () => {
    // Ini satu-satunya hal yang bisa disalin staf dari aplikasi WhatsApp, jadi
    // ia yang paling mungkin ditempel. Pesannya harus mengarahkan, bukan
    // sekadar menolak.
    const hasil = parseTargetGrup('https://chat.whatsapp.com/FGh7KlmNoPq');
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.error).toMatch(/tautan undangan/i);
      expect(hasil.error).toMatch(/Muat daftar grup/i);
    }
  });

  it('menolak nomor telepon biasa -- itu tujuan personal, bukan grup', () => {
    expect(parseTargetGrup('081234567890')).toMatchObject({ ok: false });
  });

  it('menolak JID perorangan yang tersasar ke kotak grup', () => {
    expect(parseTargetGrup('628123456789@c.us')).toMatchObject({ ok: false });
  });

  it('menolak kosong', () => {
    expect(parseTargetGrup('   ')).toMatchObject({ ok: false });
  });
});

describe('parseTargetPersonal', () => {
  it.each([
    ['081234567890', '6281234567890@c.us'],
    ['6281234567890', '6281234567890@c.us'],
    ['+62 812-3456-7890', '6281234567890@c.us'],
    ['81234567890', '6281234567890@c.us'],
  ])('menormalkan %s menjadi %s', (masukan, harapan) => {
    expect(parseTargetPersonal(masukan)).toEqual({ ok: true, chatId: harapan, jenis: 'personal' });
  });

  it('menolak nomor telepon rumah dengan alasan yang menjelaskan', () => {
    const hasil = parseTargetPersonal('0217654321');
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.error).toMatch(/bukan nomor seluler/i);
  });

  it('menolak kode grup yang tersasar ke kotak nomor', () => {
    expect(parseTargetPersonal('120363402118136446@g.us')).toMatchObject({ ok: false });
  });

  it('menolak terlalu pendek', () => {
    expect(parseTargetPersonal('0812')).toMatchObject({ ok: false });
  });
});

describe('parseTarget', () => {
  it('memilih pemeriksa sesuai jenisnya', () => {
    expect(parseTarget('grup', '120363402118136446')).toMatchObject({ jenis: 'grup' });
    expect(parseTarget('personal', '081234567890')).toMatchObject({ jenis: 'personal' });
  });
});

describe('tampilkanChatId', () => {
  it('nomor personal ditampilkan sebagai nomor lagi, grup apa adanya', () => {
    expect(tampilkanChatId('6281234567890@c.us')).toBe('6281234567890');
    expect(tampilkanChatId('120363402118136446@g.us')).toBe('120363402118136446@g.us');
  });
});

describe('isChatIdValid', () => {
  it('meloloskan kedua bentuk yang sah', () => {
    expect(isChatIdValid('120363402118136446@g.us')).toBe(true);
    expect(isChatIdValid('6281234567890@c.us')).toBe(true);
  });

  it('menolak server yang bukan keduanya', () => {
    // Penjaga terakhir sebelum nilai dari database diserahkan ke WhatsApp:
    // satu baris yang disunting lewat SQL tidak boleh bisa mengarahkan
    // pengiriman ke jenis alamat yang tidak pernah diputuskan siapa pun.
    expect(isChatIdValid('628123456789@lid')).toBe(false);
    expect(isChatIdValid('status@broadcast')).toBe(false);
    expect(isChatIdValid('120363402118136446')).toBe(false);
    expect(isChatIdValid('')).toBe(false);
  });
});
