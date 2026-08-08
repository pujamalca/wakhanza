import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRIGGER_LABEL, TRIGGER_SOURCE, triggerSource } from './labels';

/**
 * Halaman /template merender apa yang ada di tabel `template`, sementara
 * keterangan tiap barisnya (`TRIGGER_SOURCE`) ditulis tangan di kode. Dua
 * daftar yang harus sepakat tapi hidup di tempat berbeda adalah bentuk
 * kegagalan yang sudah berkali-kali dibayar di proyek ini -- dan di sini
 * penyimpangannya tidak menghasilkan satu pun galat: pemicu baru sekadar muncul
 * TANPA keterangan, dan keterangan yang tertinggal menjelaskan pemicu yang
 * tidak ada di layar mana pun.
 *
 * Karena itu daftar acuannya diambil dari MIGRASINYA, bukan disalin jadi daftar
 * ketiga di dalam uji ini. Migrasi adalah satu-satunya sumber kebenaran soal
 * baris `template` mana yang benar-benar ada, dan ia dibaca dari berkas
 * sehingga uji ini tetap tidak butuh database.
 */
const AKAR = join(__dirname, '..', '..', '..');

function kodePemicuDariMigrasi(): string[] {
  const kode: string[] = [];
  for (const nama of readdirSync(join(AKAR, 'migrations')).sort()) {
    if (!nama.endsWith('.sql')) continue;
    const baris = readFileSync(join(AKAR, 'migrations', nama), 'utf8').split('\n');
    for (let i = 0; i < baris.length; i++) {
      if (!/^INSERT INTO template\s*\(/.test(baris[i] ?? '')) continue;
      // Pernyataannya dibaca baris demi baris sampai titik komanya, bukan lewat
      // satu regex atas seluruh berkas: badan template memuat kalimat bebas
      // berikut tanda kutip, dan mencocokkannya secara global gampang menyeret
      // potongan teks yang kebetulan berbentuk mirip.
      for (let j = i + 1; j < baris.length; j++) {
        const isi = baris[j] ?? '';
        const m = /^\(\s*'([A-Z][A-Z0-9_]*)'\s*,/.exec(isi);
        if (m?.[1]) kode.push(m[1]);
        if (isi.trimEnd().endsWith(';')) break;
      }
    }
  }
  return kode;
}

describe('TRIGGER_SOURCE', () => {
  const dariMigrasi = kodePemicuDariMigrasi();

  it('migrasinya benar-benar terbaca (kalau nol, parsernya yang rusak, bukan produknya)', () => {
    expect(dariMigrasi.length).toBeGreaterThanOrEqual(11);
    expect(dariMigrasi).toContain('QUEUE_REG');
    expect(dariMigrasi).toContain('KONTROL_TERBIT');
    expect(new Set(dariMigrasi).size).toBe(dariMigrasi.length);
  });

  it('setiap baris template yang dimigrasikan punya keterangan sumbernya', () => {
    const tanpaKeterangan = dariMigrasi.filter((k) => !TRIGGER_SOURCE[k]);
    expect(tanpaKeterangan).toEqual([]);
  });

  it('setiap baris template yang dimigrasikan punya label manusianya', () => {
    const tanpaLabel = dariMigrasi.filter((k) => !TRIGGER_LABEL[k]);
    expect(tanpaLabel).toEqual([]);
  });

  it('tidak menjelaskan pemicu yang bukan baris template', () => {
    // Kebalikannya sama pentingnya: keterangan untuk FARMASI_*/BPJS_*/SURAT_SAKIT
    // menjanjikan baris yang tidak akan pernah muncul di halaman Template,
    // karena pemicu itu punya halamannya sendiri.
    const berlebih = Object.keys(TRIGGER_SOURCE).filter((k) => !dariMigrasi.includes(k));
    expect(berlebih).toEqual([]);
  });

  it('menyebut tabel dan kapan berbunyinya, bukan sekadar ada', () => {
    for (const [kode, s] of Object.entries(TRIGGER_SOURCE)) {
      expect(s.tabel.length).toBeGreaterThan(0);
      // Nama tabel ditulis apa adanya seperti di FROM -- huruf kecil bergaris
      // bawah. Nama berspasi hampir pasti label, dan label tidak bisa dicari di
      // Khanza maupun dicocokkan dengan query pollernya.
      for (const t of s.tabel) expect(t).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(s.kapan.length).toBeGreaterThan(20);
      expect(kode).toBe(kode.toUpperCase());
    }
  });

  it('kode tak dikenal tidak dipaksakan jadi keterangan karangan', () => {
    expect(triggerSource('PEMICU_YANG_TIDAK_ADA')).toBeUndefined();
  });
});
