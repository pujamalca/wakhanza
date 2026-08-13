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

/**
 * Pemicu yang BUKAN baris `template` -- FARMASI_*, BPJS_*, SURAT_SAKIT --
 * dikecualikan dari kedua pemeriksaan di atas, dan pengecualian itu benar untuk
 * `TRIGGER_SOURCE` (mereka punya halamannya sendiri). Tapi ia sekaligus membuat
 * mereka lolos dari pemeriksaan LABEL, dan celah itu terbukti nyata: tiga kode
 * (`FARMASI_PENGADAAN`, `FARMASI_PEMESANAN`, `FARMASI_HIBAH`) hidup berbulan-
 * bulan tanpa label, sehingga halaman Antrean dan Log menampilkan kode mentah
 * untuk pesan yang benar-benar terkirim ke grup apotek.
 *
 * Kegagalannya diam sempurna: `triggerLabel()` jatuh ke `?? code`, jadi tidak
 * ada galat, tidak ada baris kosong, cuma tulisan yang tidak berarti apa-apa
 * bagi petugas. Dan ia berulang -- tiga kali, pada tiga fitur berturut-turut.
 *
 * Acuannya dibaca dari KODENYA, bukan disalin jadi daftar kedua di sini.
 *
 * Versi pertama gerbang ini cuma membaca `export const TRIGGER_* = '...'` di
 * `src/worker/*.ts`, dan menyatakan dirinya "satu-satunya sumber kebenaran soal
 * kode mana yang bisa muncul di layar". Klaim itu KELIRU, dan terukur: `outbox`
 * produksi memuat 20 kode berbeda, delapan di antaranya tidak pernah diperiksa
 * gerbang ini -- `ADMINISTRASI`, `AUTO_REPLY`, `BPJS_BATAL`, `BPJS_KONTROL`,
 * `BROADCAST`, `FARMASI_UJI`, `FARMASI_VALIDASI`, `FARMASI_PENYERAHAN`.
 * Kedelapannya kebetulan punya label, tapi kebetulan bukan penegakan.
 *
 * Sebabnya: `outbox.trigger_code` lahir dari `PipelineContext.triggerCode`, dan
 * itu diisi lewat EMPAT bentuk berbeda -- konstanta runner, properti objek
 * (`triggerCode: 'BROADCAST'`), parameter berdefault (`triggerCode =
 * 'ADMINISTRASI'`), dan argumen pertama `loadFarmasiContext()`. Gerbang yang
 * cuma mengenali bentuk pertama meloloskan tiga sisanya, dan bentuk kedualah
 * yang paling gampang dipakai fitur berikutnya.
 *
 * Yang SENGAJA tidak ikut: prefiks yang cuma dipakai sebagai kunci idempoten
 * (`BPJS_BATAL_REKAP`, `BROADCAST_FOLLOWUP`, `BOOKING_SCAN`). Ketiganya tidak
 * pernah menjadi `trigger_code` -- barisnya ditulis dengan kode induknya --
 * jadi menuntut label untuknya berarti menjanjikan baris yang tidak ada.
 */
const POLA_KODE_PEMICU = [
  /^export const TRIGGER_[A-Z0-9_]+ = '([A-Z][A-Z0-9_]*)';/gm,
  /triggerCode:\s*'([A-Z][A-Z0-9_]*)'/g,
  /triggerCode\s*=\s*'([A-Z][A-Z0-9_]*)'/g,
  /loadFarmasiContext\(\s*'([A-Z][A-Z0-9_]*)'/g,
];

function berkasSumber(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, nama.name);
    if (nama.isDirectory()) berkasSumber(p, keluar);
    else if ((nama.name.endsWith('.ts') || nama.name.endsWith('.tsx')) && !nama.name.includes('.test.')) keluar.push(p);
  }
  return keluar;
}

function kodePemicuDariKode(): string[] {
  const kode: string[] = [];
  // `src/app` ikut karena `/administrasi` menulis barisnya sendiri dari server
  // action, bukan lewat runner -- dan itu kode pemicu sungguhan di `outbox`.
  for (const dir of [join(AKAR, 'src', 'worker'), join(AKAR, 'src', 'app')]) {
    for (const berkas of berkasSumber(dir)) {
      const isi = readFileSync(berkas, 'utf8');
      for (const pola of POLA_KODE_PEMICU) {
        for (const m of isi.matchAll(pola)) if (m[1]) kode.push(m[1]);
      }
    }
  }
  return [...new Set(kode)].sort();
}

describe('label pemicu di luar tabel template', () => {
  const dariKode = kodePemicuDariKode();

  it('menemukan konstanta pemicunya sama sekali', () => {
    // Kalau parsernya berhenti cocok (bentuk deklarasinya berubah), daftar ini
    // jadi kosong dan pemeriksaan di bawah lolos tanpa memeriksa apa pun --
    // gerbang yang rusak DIAM, persis kelas kegagalan yang ia jaga.
    expect(dariKode.length).toBeGreaterThanOrEqual(20);
    expect(dariKode).toContain('FARMASI_PENGADAAN');
  });

  it('menjaring KEEMPAT bentuk deklarasinya, bukan cuma konstanta runner', () => {
    // Satu wakil per bentuk. Kalau salah satu polanya rusak, yang gugur cuma
    // sebagian daftar -- dan pemeriksaan "punya label" di bawah tetap hijau,
    // karena yang tersisa memang berlabel. Jadi bentuknya dipatok di sini.
    expect(dariKode).toContain('FARMASI_PENGADAAN'); // export const TRIGGER_*
    expect(dariKode).toContain('BROADCAST'); //        triggerCode: '...'
    expect(dariKode).toContain('ADMINISTRASI'); //     triggerCode = '...'
    expect(dariKode).toContain('BPJS_KONTROL'); //     loadFarmasiContext('...'
  });

  it('tidak menuntut label untuk prefiks yang cuma kunci idempoten', () => {
    // `BPJS_BATAL_REKAP`/`BROADCAST_FOLLOWUP`/`BOOKING_SCAN` tidak pernah jadi
    // trigger_code -- barisnya ditulis dengan kode induknya. Menjaringnya
    // berarti menuntut label untuk baris yang tidak akan pernah ada.
    expect(dariKode).not.toContain('BPJS_BATAL_REKAP');
    expect(dariKode).not.toContain('BROADCAST_FOLLOWUP');
    expect(dariKode).not.toContain('BOOKING_SCAN');
  });

  it('setiap pemicu yang bisa masuk outbox punya label manusianya', () => {
    const tanpaLabel = dariKode.filter((k) => !TRIGGER_LABEL[k]);
    expect(tanpaLabel).toEqual([]);
  });

  it('labelnya berbeda satu sama lain', () => {
    // Dua pemicu berlabel sama tidak bisa dibedakan di Antrean, dan itu sama
    // tidak bergunanya dengan tidak punya label -- cuma lebih sulit disadari,
    // karena layarnya tampak wajar. Nyata di sini: keempat nota barang
    // sama-sama tergoda dinamai "nota <sesuatu>".
    const label = dariKode.map((k) => TRIGGER_LABEL[k]);
    expect(new Set(label).size).toBe(label.length);
  });
});
