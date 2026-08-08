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
  it('pemicu otomatis ke pasien terikat opt-out', () => {
    for (const code of [
      'QUEUE_REG',
      'BOOK_CONFIRM',
      'BOOK_CANCEL',
      'BOOK_REMIND',
      // Hasil penunjang, dipisah per jenis sejak migrations/034. Keduanya
      // terikat lewat alasan PASANGAN yang sama seperti LAB_REQUEST/RAD_REQUEST
      // dan KONTROL_TERBIT/KONTROL_ULANG di bawah.
      'LAB_RESULT',
      'RAD_RESULT',
      'PHARMACY_READY',
      'BILLING_READY',
      // Pengingat surat kontrol BPJS: otomatis, berangkat dari sik, tanpa ada
      // manusia yang menekan apa pun -- sekelas dengan ketujuh di atasnya.
      'BPJS_KONTROL',
      // Padanannya untuk pasien NON-BPJS (migrations/032). Sepasang dengan
      // baris tepat di atasnya, dan justru karena sepasang maka
      // ketidaksamaannya akan jadi janji yang mustahil dijelaskan: pasien yang
      // sudah meminta berhenti lalu tetap diingatkan hanya karena suratnya
      // kebetulan tidak lewat bridging BPJS.
      'KONTROL_ULANG',
      // Pasangannya dari ujung yang lain: pemberitahuan saat suratnya disimpan.
      // Sekali lagi terikat karena PASANGAN -- yang satu berhenti sementara
      // satunya terus mengirim surat yang sama akan terbaca pasien sebagai
      // permintaannya diabaikan sebagian.
      'KONTROL_TERBIT',
      // Permintaan lab/radiologi -- pasangan LAB_RESULT/RAD_RESULT, yang sudah
      // terikat. Pasangan yang satu terikat sementara satunya tidak akan jadi
      // janji yang mustahil dijelaskan ke pasien yang sudah meminta berhenti.
      'LAB_REQUEST',
      'RAD_REQUEST',
      // Surat sakit yang dikirim OTOMATIS begitu dokternya menyimpan. Pasangan
      // manualnya (ADMINISTRASI) sengaja TIDAK terikat -- lihat uji berikutnya.
      'SURAT_SAKIT',
      // PENINGGALAN: tidak ada lagi pemicu berkode ini sejak migrations/034,
      // tapi baris `outbox` yang terlanjur mengantre dengannya tetap harus
      // tercoret saat pasiennya meminta berhenti.
      'RESULT_READY',
    ]) {
      expect(respectsOptOut(code)).toBe(true);
    }
    // 13 -> 15: RESULT_READY pecah jadi dua (+1), lalu kode lamanya DITAHAN
    // sebagai peninggalan (+1) supaya baris `outbox` yang terlanjur mengantre
    // dengannya tetap tercoret saat pasiennya meminta berhenti.
    expect(optOutTriggerCodes()).toHaveLength(15);
  });

  it('BROADCAST dan AUTO_REPLY TIDAK terikat -- kanal terpisah, keputusan RS', () => {
    expect(respectsOptOut('BROADCAST')).toBe(false);
    expect(respectsOptOut('AUTO_REPLY')).toBe(false);
  });

  /**
   * Surat yang SAMA lewat dua jalur, dan hanya yang otomatis yang terikat.
   * Dipatok berpasangan dalam satu uji, bukan dua: yang perlu dijaga bukan
   * nilai masing-masing melainkan bahwa keduanya BERBEDA. Menyamakannya salah
   * ke arah mana pun -- mendiamkan orang yang baru saja meminta suratnya di
   * loket, atau tetap mengirimi berkas orang yang sudah bilang berhenti.
   */
  it('surat otomatis terikat, surat yang dikirim petugas atas permintaan TIDAK', () => {
    expect(respectsOptOut('SURAT_SAKIT')).toBe(true);
    expect(respectsOptOut('ADMINISTRASI')).toBe(false);
  });

  it('pemicu yang penerimanya STAF tidak terikat -- tidak ada nomor pasien untuk dicocokkan', () => {
    expect(respectsOptOut('FARMASI_VALIDASI')).toBe(false);
    expect(respectsOptOut('FARMASI_STOK_DARURAT')).toBe(false);
    expect(respectsOptOut('BPJS_BATAL')).toBe(false);
  });

  it('kode yang tidak dikenal dianggap TIDAK terikat, bukan diam-diam terikat', () => {
    // Pemicu baru harus didaftarkan secara sadar. Default "terikat" akan
    // membuat kanal baru diam-diam berhenti terkirim tanpa ada yang memutuskan.
    expect(respectsOptOut('PEMICU_BARU')).toBe(false);
  });
});
