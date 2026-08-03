import {
  bolehHapus,
  bolehNonaktifkan,
  bolehUbahPeran,
  periksaSandi,
  periksaUsername,
  periksaNama,
  PANJANG_SANDI_MINIMAL,
  type KeadaanPerubahan,
} from './userPolicy';

function keadaan(ubah: Partial<KeadaanPerubahan> = {}): KeadaanPerubahan {
  return { peranSekarang: 'admin', aktifSekarang: true, adminAktif: 2, diriSendiri: false, ...ubah };
}

describe('bolehNonaktifkan', () => {
  it('admin biasa boleh dinonaktifkan selama masih ada admin lain', () => {
    expect(bolehNonaktifkan(keadaan({ adminAktif: 2 }))).toBeNull();
  });

  it('admin aktif TERAKHIR ditolak', () => {
    expect(bolehNonaktifkan(keadaan({ adminAktif: 1 }))).toMatch(/satu-satunya admin/i);
  });

  it('operator boleh dinonaktifkan walau tinggal satu admin -- ia bukan admin', () => {
    expect(bolehNonaktifkan(keadaan({ peranSekarang: 'operator', adminAktif: 1 }))).toBeNull();
  });

  it('admin yang SUDAH nonaktif tidak ikut dihitung sebagai admin terakhir', () => {
    // adminAktif=1 adalah admin LAIN; sasaran ini sudah nonaktif sejak awal.
    expect(bolehNonaktifkan(keadaan({ aktifSekarang: false, adminAktif: 1 }))).toBeNull();
  });

  it('menonaktifkan akun sendiri ditolak walau admin lain masih banyak', () => {
    expect(bolehNonaktifkan(keadaan({ diriSendiri: true, adminAktif: 5 }))).toMatch(/akun sendiri/i);
  });

  it('pagar admin terakhir menang atas pagar diri sendiri (pesannya yang lebih penting)', () => {
    expect(bolehNonaktifkan(keadaan({ diriSendiri: true, adminAktif: 1 }))).toMatch(/satu-satunya admin/i);
  });
});

describe('bolehUbahPeran', () => {
  it('menurunkan admin terakhir jadi operator ditolak -- sama merusaknya dengan menonaktifkan', () => {
    expect(bolehUbahPeran(keadaan({ adminAktif: 1 }), 'operator')).toMatch(/satu-satunya admin/i);
  });

  it('menurunkan admin biasa boleh', () => {
    expect(bolehUbahPeran(keadaan({ adminAktif: 3 }), 'operator')).toBeNull();
  });

  it('menaikkan operator jadi admin selalu boleh', () => {
    expect(bolehUbahPeran(keadaan({ peranSekarang: 'operator', adminAktif: 1 }), 'admin')).toBeNull();
  });

  it('peran yang tidak berubah bukan perubahan, jadi tidak ada yang perlu ditolak', () => {
    expect(bolehUbahPeran(keadaan({ adminAktif: 1, diriSendiri: true }), 'admin')).toBeNull();
  });

  it('menurunkan peran sendiri ditolak', () => {
    expect(bolehUbahPeran(keadaan({ diriSendiri: true, adminAktif: 4 }), 'operator')).toMatch(/akun sendiri/i);
  });

  it('admin NONAKTIF yang diturunkan tidak kena pagar admin terakhir', () => {
    expect(bolehUbahPeran(keadaan({ aktifSekarang: false, adminAktif: 1 }), 'operator')).toBeNull();
  });
});

describe('bolehHapus', () => {
  it('operator boleh dihapus', () => {
    expect(bolehHapus(keadaan({ peranSekarang: 'operator', adminAktif: 1 }))).toBeNull();
  });

  it('admin biasa boleh dihapus selama masih ada admin lain', () => {
    expect(bolehHapus(keadaan({ adminAktif: 2 }))).toBeNull();
  });

  it('admin aktif TERAKHIR ditolak', () => {
    expect(bolehHapus(keadaan({ adminAktif: 1 }))).toMatch(/satu-satunya admin/i);
  });

  it('menghapus akun sendiri ditolak walau admin lain masih banyak', () => {
    expect(bolehHapus(keadaan({ diriSendiri: true, adminAktif: 5 }))).toMatch(/akun sendiri/i);
  });

  it('pagar admin terakhir menang atas pagar diri sendiri', () => {
    expect(bolehHapus(keadaan({ diriSendiri: true, adminAktif: 1 }))).toMatch(/satu-satunya admin/i);
  });

  it('admin NONAKTIF boleh dihapus walau tinggal satu admin aktif -- ia bukan admin itu', () => {
    expect(bolehHapus(keadaan({ aktifSekarang: false, adminAktif: 1 }))).toBeNull();
  });

  it('akun yang SUDAH nonaktif tetap boleh dihapus -- beda dari menonaktifkan, ini masih perubahan', () => {
    // bolehNonaktifkan() meloloskannya karena "bukan perubahan"; di sini
    // barisnya tetap hilang, jadi tidak ada jalan pintas yang setara.
    expect(bolehNonaktifkan(keadaan({ aktifSekarang: false, diriSendiri: true }))).toBeNull();
    expect(bolehHapus(keadaan({ aktifSekarang: false, diriSendiri: true }))).toMatch(/akun sendiri/i);
  });
});

describe('periksaSandi', () => {
  it(`menolak lebih pendek dari ${PANJANG_SANDI_MINIMAL}`, () => {
    expect(periksaSandi('1234567')).toMatch(/minimal/i);
  });

  it('menerima yang cukup panjang tanpa memaksa kombinasi karakter', () => {
    expect(periksaSandi('kata sandi yang panjang sekali')).toBeNull();
  });
});

describe('periksaUsername', () => {
  it.each([
    ['ab', /minimal/i],
    ['Budi', /huruf kecil/i],
    ['budi santoso', /huruf kecil/i],
    ['budi@rs', /huruf kecil/i],
  ])('menolak %s', (nilai, pola) => {
    expect(periksaUsername(nilai)).toMatch(pola);
  });

  it.each(['budi', 'budi.santoso', 'budi_s', 'op-loket1', 'admin2'])('menerima %s', (nilai) => {
    expect(periksaUsername(nilai)).toBeNull();
  });

  it('menolak yang melebihi lebar kolom database', () => {
    expect(periksaUsername('a'.repeat(51))).toMatch(/maksimal/i);
  });
});

describe('periksaNama', () => {
  it('menolak kosong dan spasi saja', () => {
    expect(periksaNama('')).toMatch(/wajib/i);
    expect(periksaNama('   ')).toMatch(/wajib/i);
  });

  it('menerima nama dengan spasi dan huruf besar -- ini nama orang, bukan username', () => {
    expect(periksaNama('Budi Santoso')).toBeNull();
  });

  it('menolak yang melebihi lebar kolom database', () => {
    expect(periksaNama('a'.repeat(81))).toMatch(/maksimal/i);
  });
});
