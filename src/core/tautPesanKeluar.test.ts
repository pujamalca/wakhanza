import { layakCatatSebagaiBalasanManual, pilihBarisTertaut, type BarisTujuan } from './tautPesanKeluar';

/**
 * Bentuk alamat yang benar-benar diamati di sesi produksi saat cacat ini
 * ditemukan (17 Agustus 2026). Nomornya sengaja DIKARANG -- yang perlu ditiru
 * bentuknya, bukan identitasnya.
 */
const GRUP = '120363000000000001@g.us';
const GRUP_LAIN = '120363000000000002@g.us';
const PETUGAS = '6281200000001@c.us';

/** Pantulan `message_create` untuk percakapan perorangan. Nomor TIDAK ada di sini. */
const LID = '205000000000001@lid';
const LID_LAIN = '205000000000002@lid';

function pasien(phoneE164: string): BarisTujuan {
  return { chatId: null, phoneE164 };
}
function tujuan(chatId: string): BarisTujuan {
  return { chatId, phoneE164: null };
}

describe('pilihBarisTertaut -- grup (yang SUDAH bekerja, dijaga jangan mundur)', () => {
  it('mencocokkan grup lewat chat_id persis', () => {
    const baris = tujuan(GRUP);
    expect(pilihBarisTertaut([baris, tujuan(GRUP_LAIN)], GRUP)).toEqual({ baris });
  });

  it('menolak bila tidak ada grup yang cocok', () => {
    expect(pilihBarisTertaut([tujuan(GRUP_LAIN)], GRUP)).toEqual({ baris: null, sebab: 'tak-cocok' });
  });

  /**
   * Yang paling penting dijaga dari kelonggaran LID di bawah: alamat grup TIDAK
   * pernah boleh jatuh ke baris pasien. Salinan ke grup dan pesan ke pasien
   * bisa punya isi yang sama persis pada pemicu bermode `pasien_dan_tujuan`,
   * dan menautkannya silang berarti konfirmasi milik grup dilaporkan sebagai
   * konfirmasi milik pasien -- kebalikan dari guna fitur ini.
   */
  it('alamat grup TIDAK PERNAH jatuh ke baris pasien', () => {
    expect(pilihBarisTertaut([pasien('6281200000009')], GRUP)).toEqual({ baris: null, sebab: 'tak-cocok' });
  });
});

describe('pilihBarisTertaut -- perorangan ber-@c.us', () => {
  it('mencocokkan baris pasien lewat nomornya', () => {
    const baris = pasien('6281200000001');
    expect(pilihBarisTertaut([baris], PETUGAS)).toEqual({ baris });
  });

  it('mencocokkan tujuan petugas lewat chat_id persis', () => {
    const baris = tujuan(PETUGAS);
    expect(pilihBarisTertaut([baris], PETUGAS)).toEqual({ baris });
  });
});

describe('pilihBarisTertaut -- @lid, INILAH cacat yang diperbaiki', () => {
  /**
   * Terukur di produksi: 0 dari 114 baris beralamat perorangan pernah tertaut,
   * sementara grup mencapai 98,7% sejak 10 Agustus. Sebabnya WhatsApp
   * memantulkan `to` sebagai `<lid>@lid` -- nomornya sengaja tidak ada di
   * dalamnya -- sehingga `${phoneE164}@c.us === tujuan` tidak pernah benar.
   */
  it('menautkan baris pasien walau nomornya tidak ada di alamat pantulan', () => {
    const baris = pasien('6281200000001');
    expect(pilihBarisTertaut([baris], LID)).toEqual({ baris });
  });

  it('menautkan tujuan petugas ber-@c.us yang dipantulkan sebagai @lid', () => {
    const baris = tujuan(PETUGAS);
    expect(pilihBarisTertaut([baris], LID)).toEqual({ baris });
  });

  /**
   * Pengaman pengganti. Alamat LID tidak memuat nomor, jadi tidak ada yang bisa
   * dibandingkan; yang menggantikannya KETUNGGALAN. Isi pesan sudah unik lewat
   * kode pengiriman (terukur 888 baris / 888 isi berbeda, 0 kembar dalam 30
   * menit), jadi dua kandidat perorangan sekaligus hanya mungkin bila kode itu
   * dimatikan -- dan di sana menebak salah satunya lebih buruk daripada diam.
   */
  it('MENOLAK bila ada lebih dari satu kandidat perorangan', () => {
    expect(pilihBarisTertaut([pasien('6281200000001'), pasien('6281200000002')], LID)).toEqual({
      baris: null,
      sebab: 'ambigu',
    });
  });

  it('MENOLAK bila satu-satunya kandidat adalah grup', () => {
    expect(pilihBarisTertaut([tujuan(GRUP)], LID)).toEqual({ baris: null, sebab: 'tak-cocok' });
  });

  it('memilih SATU baris perorangan walau ada grup lain di daftar kandidat', () => {
    const baris = pasien('6281200000001');
    expect(pilihBarisTertaut([tujuan(GRUP), baris, tujuan(GRUP_LAIN)], LID)).toEqual({ baris });
  });

  /**
   * Kecocokan PERSIS tetap menang atas kelonggaran ketunggalan. Tanpa ini,
   * daftar berisi dua baris ber-chat_id LID berbeda akan dinilai ambigu padahal
   * salah satunya cocok kata demi kata.
   */
  it('kecocokan persis menang atas aturan ketunggalan', () => {
    const baris = tujuan(LID);
    expect(pilihBarisTertaut([baris, tujuan(LID_LAIN)], LID)).toEqual({ baris });
  });
});

describe('pilihBarisTertaut -- daftar kosong', () => {
  it('membedakan "tidak ada kandidat" dari "ada tapi tak cocok"', () => {
    expect(pilihBarisTertaut([], LID)).toEqual({ baris: null, sebab: 'tanpa-kandidat' });
    expect(pilihBarisTertaut([], GRUP)).toEqual({ baris: null, sebab: 'tanpa-kandidat' });
  });

  /**
   * Alamat yang bentuknya tidak terbaca TIDAK boleh jatuh ke kelonggaran LID:
   * yang membenarkan kelonggaran itu adalah pengetahuan bahwa `@lid` pasti
   * perorangan, dan bentuk asing tidak memberi pengetahuan apa pun.
   */
  it('alamat tak terbaca tidak mendapat kelonggaran apa pun', () => {
    expect(pilihBarisTertaut([pasien('6281200000001')], 'entah-apa')).toEqual({ baris: null, sebab: 'tak-cocok' });
    expect(pilihBarisTertaut([pasien('6281200000001')], '')).toEqual({ baris: null, sebab: 'tak-cocok' });
  });
});

/**
 * Pesan keluar yang TIDAK punya baris `outbox` adalah balasan yang diketik
 * MANUSIA dari ponsel nomor rumah sakit -- satu-satunya bentuk balasan yang
 * benar-benar dipakai di sini (terukur: `BALAS_MANUAL` nol baris selamanya,
 * sementara 19 pesan keluar manusia dalam 4 hari).
 */
describe('layakCatatSebagaiBalasanManual', () => {
  it('mencatat balasan perorangan yang dipantulkan sebagai @lid', () => {
    expect(layakCatatSebagaiBalasanManual(LID, 'tanpa-kandidat')).toBe(true);
  });

  it('mencatat balasan ke nomor ber-@c.us', () => {
    expect(layakCatatSebagaiBalasanManual(PETUGAS, 'tanpa-kandidat')).toBe(true);
  });

  it('mencatat pesan yang diketik petugas di dalam grup', () => {
    expect(layakCatatSebagaiBalasanManual(GRUP, 'tanpa-kandidat')).toBe(true);
  });

  /**
   * Unggahan status menghasilkan `message_create`-nya sendiri dan jumlahnya
   * MELEBIHI balasan sungguhan (terukur 15 dari 34 dalam 4 hari). Ia bukan
   * percakapan dengan siapa pun; mencatatnya berarti mengotori tiap daftar.
   */
  it('TIDAK mencatat unggahan status', () => {
    expect(layakCatatSebagaiBalasanManual('status@broadcast', 'tanpa-kandidat')).toBe(false);
  });

  it('TIDAK mencatat saluran maupun alamat yang belum dikenal', () => {
    expect(layakCatatSebagaiBalasanManual('123@newsletter', 'tanpa-kandidat')).toBe(false);
    expect(layakCatatSebagaiBalasanManual('123@entah', 'tanpa-kandidat')).toBe(false);
    expect(layakCatatSebagaiBalasanManual('', 'tanpa-kandidat')).toBe(false);
  });

  /**
   * Pagar yang paling menentukan. `tak-cocok` dan `ambigu` berarti kandidatnya
   * ADA -- pesannya lahir dari `outbox` dan sudah tampil di sisi keluar
   * percakapan. Mencatatnya lagi di sini menggandakan gelembungnya, dan yang
   * ganda justru pesan sistem ke pasien.
   */
  it('TIDAK mencatat bila kandidat outbox ADA tapi penautannya gagal', () => {
    expect(layakCatatSebagaiBalasanManual(LID, 'tak-cocok')).toBe(false);
    expect(layakCatatSebagaiBalasanManual(LID, 'ambigu')).toBe(false);
    expect(layakCatatSebagaiBalasanManual(GRUP, 'tak-cocok')).toBe(false);
  });
});
