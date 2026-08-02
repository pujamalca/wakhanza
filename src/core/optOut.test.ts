import { isOptOutRequest, respectsOptOut, optOutTriggerCodes, OPT_OUT_PHRASE } from './optOut';

describe('isOptOutRequest', () => {
  it('menerima frasa persis', () => {
    expect(isOptOutRequest(OPT_OUT_PHRASE)).toBe(true);
    expect(isOptOutRequest('Berhenti Kirim Otomatis')).toBe(true);
  });

  it('mengabaikan huruf besar-kecil, tanda baca, dan spasi berlebih', () => {
    expect(isOptOutRequest('BERHENTI KIRIM OTOMATIS')).toBe(true);
    expect(isOptOutRequest('  berhenti   kirim   otomatis  ')).toBe(true);
    expect(isOptOutRequest('Berhenti Kirim Otomatis!')).toBe(true);
    expect(isOptOutRequest('berhenti, kirim otomatis.')).toBe(true);
  });

  it('menerima frasa di tengah kalimat -- ini yang tidak bisa dilakukan pola lama', () => {
    expect(isOptOutRequest('saya mau berhenti kirim otomatis ya pak')).toBe(true);
    expect(isOptOutRequest('tolong berhenti kirim otomatis')).toBe(true);
  });

  it('TIDAK berhenti hanya karena ada kata "berhenti" atau "stop"', () => {
    expect(isOptOutRequest('berhenti')).toBe(false);
    expect(isOptOutRequest('stop')).toBe(false);
    expect(isOptOutRequest('bus berhenti di depan rumah sakit')).toBe(false);
    expect(isOptOutRequest('kirim otomatis')).toBe(false);
  });

  it('urutan kata harus utuh, bukan sekadar ketiganya muncul', () => {
    expect(isOptOutRequest('otomatis kirim berhenti')).toBe(false);
    expect(isOptOutRequest('berhenti dulu ya, kirim otomatis saja')).toBe(false);
  });

  it('pesan kosong atau tanpa huruf tidak pernah dianggap permintaan berhenti', () => {
    expect(isOptOutRequest('')).toBe(false);
    expect(isOptOutRequest('   ')).toBe(false);
    expect(isOptOutRequest('👍')).toBe(false);
  });
});

describe('respectsOptOut', () => {
  it('ketujuh pemicu otomatis terikat opt-out', () => {
    for (const code of ['QUEUE_REG', 'BOOK_CONFIRM', 'BOOK_CANCEL', 'BOOK_REMIND', 'RESULT_READY', 'PHARMACY_READY', 'BILLING_READY']) {
      expect(respectsOptOut(code)).toBe(true);
    }
    expect(optOutTriggerCodes()).toHaveLength(7);
  });

  it('BROADCAST dan AUTO_REPLY TIDAK terikat -- kanal terpisah, keputusan RS', () => {
    expect(respectsOptOut('BROADCAST')).toBe(false);
    expect(respectsOptOut('AUTO_REPLY')).toBe(false);
  });

  it('kode yang tidak dikenal dianggap TIDAK terikat, bukan diam-diam terikat', () => {
    // Pemicu baru harus didaftarkan secara sadar. Default "terikat" akan
    // membuat kanal baru diam-diam berhenti terkirim tanpa ada yang memutuskan.
    expect(respectsOptOut('PEMICU_BARU')).toBe(false);
  });
});
