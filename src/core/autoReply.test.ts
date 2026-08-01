import { normalizeInbound, matchRule, detectPoli, reducePoliName, type MatchableRule } from './autoReply';

const rule = (id: number, keywords: string[], extra: Partial<MatchableRule> = {}): MatchableRule => ({
  id,
  keywords,
  matchMode: 'contains',
  priority: 100,
  ...extra,
});

describe('normalizeInbound', () => {
  it('menyeragamkan huruf besar-kecil, tanda baca, dan emoji', () => {
    expect(normalizeInbound('Assalamualaikum, mau tanya JADWAL Dokter dong 🙏')).toBe(
      'assalamualaikum mau tanya jadwal dokter dong',
    );
  });

  it('membuang aksen sehingga bentuk beraksen dan tidak beraksen bertemu', () => {
    expect(normalizeInbound('Ápa Kabár?!')).toBe('apa kabar');
  });

  it('mempertahankan angka -- kata kunci berangka lazim dipakai RS', () => {
    expect(normalizeInbound('Info 24 Jam / Poli 1')).toBe('info 24 jam poli 1');
  });

  it('meratakan baris baru jadi spasi, bukan membiarkannya jadi pemisah tersendiri', () => {
    expect(normalizeInbound('jadwal\n\ndokter')).toBe('jadwal dokter');
  });

  it('pesan tanpa huruf/angka sama sekali jadi string kosong', () => {
    expect(normalizeInbound('👍👍👍')).toBe('');
    expect(normalizeInbound('   ')).toBe('');
  });
});

describe('matchRule', () => {
  it('mencocokkan kata kunci di tengah kalimat', () => {
    const r = rule(1, ['jadwal dokter']);
    expect(matchRule('halo, mau tanya jadwal dokter ya', [r])?.rule.id).toBe(1);
  });

  it('melaporkan kata kunci mana yang cocok, bukan cuma aturannya', () => {
    const r = rule(1, ['jadwal dokter', 'jadwal praktek']);
    expect(matchRule('jadwal praktek hari ini?', [r])?.keyword).toBe('jadwal praktek');
  });

  it('TIDAK cocok pada potongan kata -- "obat" bukan bagian dari "obatan"', () => {
    const r = rule(1, ['obat']);
    expect(matchRule('makanan dan obatan herbal', [r])).toBeNull();
    expect(matchRule('apakah obat saya sudah siap', [r])?.rule.id).toBe(1);
  });

  it('kata kunci pendek tidak meletus di tengah kata lain', () => {
    const r = rule(1, ['rm']);
    expect(matchRule('sudah alarm belum', [r])).toBeNull();
    expect(matchRule('no rm saya berapa', [r])?.rule.id).toBe(1);
  });

  it('mode exact hanya cocok bila SELURUH pesan sama dengan kata kuncinya', () => {
    const r = rule(1, ['menu'], { matchMode: 'exact' });
    expect(matchRule('menu', [r])?.rule.id).toBe(1);
    expect(matchRule('Menu!', [r])?.rule.id).toBe(1); // dinormalisasi dulu
    expect(matchRule('kirim menu dong', [r])).toBeNull();
  });

  it('prioritas kecil menang, bukan urutan larik maupun kecocokan terpanjang', () => {
    const umum = rule(1, ['jadwal'], { priority: 100 });
    const khusus = rule(2, ['jadwal dokter'], { priority: 10 });
    expect(matchRule('jadwal dokter besok', [umum, khusus])?.rule.id).toBe(2);
  });

  it('prioritas sama diputus id terkecil supaya hasilnya stabil, bukan bergantung urutan query', () => {
    const a = rule(7, ['halo']);
    const b = rule(3, ['halo']);
    expect(matchRule('halo', [a, b])?.rule.id).toBe(3);
    expect(matchRule('halo', [b, a])?.rule.id).toBe(3);
  });

  it('pesan kosong atau tanpa huruf tidak pernah memicu aturan apa pun', () => {
    const r = rule(1, ['halo']);
    expect(matchRule('👍', [r])).toBeNull();
    expect(matchRule('', [r])).toBeNull();
  });

  it('kata kunci kosong diabaikan, tidak menjadikan aturan cocok untuk segalanya', () => {
    const r = rule(1, ['', '   ', 'halo']);
    expect(matchRule('pesan apa saja', [r])).toBeNull();
    expect(matchRule('halo', [r])?.rule.id).toBe(1);
  });

  it('kata kunci yang tersimpan belum ternormalisasi tetap cocok', () => {
    const r = rule(1, ['Jadwal Dokter!']);
    expect(matchRule('mau tanya jadwal dokter', [r])?.rule.id).toBe(1);
  });
});

describe('reducePoliName', () => {
  it('membuang kata pembungkus supaya tersisa nama layanannya', () => {
    expect(reducePoliName('Poliklinik Jantung')).toBe('jantung');
    expect(reducePoliName('Poliklinik Penyakit Dalam')).toBe('penyakit dalam');
    expect(reducePoliName('Instalasi Rawat Jalan')).toBe('');
  });
});

describe('detectPoli', () => {
  const options = [
    { kdPoli: 'U0012', namaPoli: 'Poliklinik Jantung' },
    { kdPoli: 'U0003', namaPoli: 'Poliklinik Penyakit Dalam' },
    { kdPoli: 'U0005', namaPoli: 'Poliklinik Mata' },
    { kdPoli: 'U0027', namaPoli: 'Poliklinik Paru' },
  ];

  it('mengenali poli yang disebut pasien', () => {
    expect(detectPoli('jadwal dokter jantung', options)?.kdPoli).toBe('U0012');
    expect(detectPoli('dokter MATA praktek kapan?', options)?.kdPoli).toBe('U0005');
  });

  it('frasa penuh dikenali walau tokennya juga muncul di poli lain', () => {
    const withKulit = [...options, { kdPoli: 'U0009', namaPoli: 'Poliklinik Penyakit Kulit' }];
    expect(detectPoli('jadwal poli penyakit dalam', withKulit)?.kdPoli).toBe('U0003');
  });

  it('ambigu dikembalikan null, bukan menebak salah satu', () => {
    const withKulit = [...options, { kdPoli: 'U0009', namaPoli: 'Poliklinik Penyakit Kulit' }];
    expect(detectPoli('jadwal poli penyakit', withKulit)).toBeNull();
  });

  it('tanpa sebutan poli mana pun mengembalikan null', () => {
    expect(detectPoli('jadwal dokter dong', options)).toBeNull();
  });

  it('kata pembungkus saja tidak menjadikan poli mana pun cocok', () => {
    expect(detectPoli('poliklinik buka jam berapa', options)).toBeNull();
  });
});
