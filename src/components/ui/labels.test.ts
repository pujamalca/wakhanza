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
  let kode: string[] = [];
  for (const nama of readdirSync(join(AKAR, 'migrations')).sort()) {
    if (!nama.endsWith('.sql')) continue;
    const baris = readFileSync(join(AKAR, 'migrations', nama), 'utf8').split('\n');
    for (let i = 0; i < baris.length; i++) {
      const awal = baris[i] ?? '';

      /**
       * Baris yang DIBUANG ikut dihitung, dalam urutan berkasnya. Tanpa ini
       * `migrations/034` -- yang memecah RESULT_READY jadi LAB_RESULT dan
       * RAD_RESULT lalu menghapus baris lamanya -- akan terbaca sebagai
       * penambahan saja, dan uji ini menuntut keterangan untuk pemicu yang
       * sudah tidak ada di tabel mana pun.
       *
       * Penyaringnya sengaja `template\s+WHERE`, bukan `template`: 034 juga
       * menghapus dari `template_target`, dan itu bukan baris pemicu.
       */
      if (/^DELETE FROM template\s+WHERE/.test(awal)) {
        const dibuang = /'([A-Z][A-Z0-9_]*)'/.exec(awal)?.[1];
        if (dibuang) kode = kode.filter((k) => k !== dibuang);
        continue;
      }

      if (!/^INSERT INTO template\s*\(/.test(awal)) continue;
      // Pernyataannya dibaca baris demi baris sampai titik komanya, bukan lewat
      // satu regex atas seluruh berkas: badan template memuat kalimat bebas
      // berikut tanda kutip, dan mencocokkannya secara global gampang menyeret
      // potongan teks yang kebetulan berbentuk mirip.
      for (let j = i + 1; j < baris.length; j++) {
        const isi = baris[j] ?? '';
        // DUA bentuk: `VALUES` dengan baris `('KODE', ...)`, dan `SELECT 'KODE',
        // ... FROM template` yang dipakai 034 untuk MENYALIN isi baris lama
        // (badan pesan yang mungkin sudah disunting staf, sakelar aktifnya,
        // mode tujuannya) alih-alih menuliskannya ulang di migrasi.
        const ditambah = /^(?:\(|SELECT)\s*'([A-Z][A-Z0-9_]*)'\s*,/.exec(isi)?.[1];
        if (ditambah) kode.push(ditambah);
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

  it('pemecahan RESULT_READY terbaca sebagai pemecahan, bukan penambahan', () => {
    // Bentuk `INSERT ... SELECT` dan `DELETE` di migrations/034 keduanya harus
    // terbaca. Kalau SELECT-nya terlewat, dua pemicu yang benar-benar berjalan
    // tidak pernah diperiksa punya keterangan; kalau DELETE-nya terlewat, uji
    // ini menuntut keterangan untuk pemicu yang sudah tidak ada.
    expect(dariMigrasi).toContain('LAB_RESULT');
    expect(dariMigrasi).toContain('RAD_RESULT');
    expect(dariMigrasi).not.toContain('RESULT_READY');
  });

  it('label PENINGGALAN tetap ada walau pemicunya tidak', () => {
    // Kebalikan dari uji di atas, dan sengaja tidak simetris: `outbox` dan
    // `send_log` masih menyimpan baris ber-trigger_code RESULT_READY, dan
    // halaman Antrean/Log tidak boleh menampilkan kode mentah untuk pesan yang
    // dulu benar-benar terkirim ke pasien.
    expect(TRIGGER_LABEL.RESULT_READY).toBeDefined();
    expect(TRIGGER_SOURCE.RESULT_READY).toBeUndefined();
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
