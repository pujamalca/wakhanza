import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Daftar kode pemicu yang BENAR-BENAR jadi baris `template`, dibaca dari
 * `migrations/*.sql`.
 *
 * Sebelumnya fungsi ini tinggal di dalam `src/components/ui/labels.test.ts` dan
 * tidak diekspor, sehingga pemeriksaan BERIKUTNYA yang butuh daftar yang sama
 * -- "apakah tiap pemicu sudah punya keputusan opt-out" -- hanya punya dua
 * pilihan: menyalin parsernya, atau menyalin daftarnya. Keduanya melahirkan
 * kembali bentuk kegagalan yang paling sering dibayar di proyek ini: beberapa
 * tempat berjauhan menafsirkan sendiri satu hal yang sama, dan cukup satu yang
 * menyimpang untuk membuat satu jalur diam-diam berperilaku lain.
 *
 * Ia dibaca dari BERKAS, bukan dari database, jadi pemanggilnya tetap bisa
 * berjalan di mana saja tanpa MariaDB hidup -- syarat yang membuat `npm test`
 * dan `npm run preflight` tetap bisa dipakai sebagai pemeriksaan cepat.
 */
export function kodePemicuDariMigrasi(akar: string): string[] {
  let kode: string[] = [];
  const dir = join(akar, 'migrations');

  for (const nama of readdirSync(dir).sort()) {
    if (!nama.endsWith('.sql')) continue;
    const baris = readFileSync(join(dir, nama), 'utf8').split('\n');

    for (let i = 0; i < baris.length; i++) {
      const awal = baris[i] ?? '';

      /**
       * Baris yang DIBUANG ikut dihitung, dalam urutan berkasnya. Tanpa ini
       * `migrations/034` -- yang memecah RESULT_READY jadi LAB_RESULT dan
       * RAD_RESULT lalu menghapus baris lamanya -- akan terbaca sebagai
       * penambahan saja.
       *
       * Penyaringnya `template\s+WHERE`, bukan `template`: 034 juga menghapus
       * dari `template_target`, dan itu bukan baris pemicu.
       */
      if (/^DELETE FROM template\s+WHERE/.test(awal)) {
        const dibuang = /'([A-Z][A-Z0-9_]*)'/.exec(awal)?.[1];
        if (dibuang) kode = kode.filter((k) => k !== dibuang);
        continue;
      }

      if (!/^INSERT INTO template\s*\(/.test(awal)) continue;

      // Dibaca baris demi baris sampai titik komanya, bukan lewat satu regex
      // atas seluruh berkas: badan template memuat kalimat bebas berikut tanda
      // kutip, dan mencocokkannya secara global gampang menyeret potongan teks
      // yang kebetulan berbentuk mirip.
      for (let j = i + 1; j < baris.length; j++) {
        const isi = baris[j] ?? '';
        // DUA bentuk: `VALUES` dengan baris `('KODE', ...)`, dan `SELECT 'KODE',
        // ... FROM template` yang dipakai 034 untuk MENYALIN isi baris lama.
        const ditambah = /^(?:\(|SELECT)\s*'([A-Z][A-Z0-9_]*)'\s*,/.exec(isi)?.[1];
        if (ditambah) kode.push(ditambah);
        if (isi.trimEnd().endsWith(';')) break;
      }
    }
  }

  return kode;
}
