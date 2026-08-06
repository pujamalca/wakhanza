/**
 * Pratinjau surat keterangan sakit/sehat, dan sekaligus membuktikan BERKAS
 * PDF-nya benar-benar terbentuk -- tanpa mengirim apa pun.
 *
 * Terpisah dari `poll:dryrun` dengan dua alasan yang berbeda dari yang membuat
 * `dryrun:bpjs` terpisah:
 *
 *  1. Yang perlu dibuktikan di sini bukan bentuk PESAN melainkan bentuk
 *     BERKAS. Satu-satunya cara memeriksanya adalah menghasilkan PDF-nya lalu
 *     membukanya -- dan itu meluncurkan Chromium, yang tidak boleh jadi bagian
 *     dari pratinjau pemicu yang dijalankan rutin.
 *  2. `suratsakit` sering kosong di instalasi yang belum memakai modulnya, dan
 *     `surat_keterangan_sehat` KOSONG di kedua database di mesin ini. Nol
 *     baris tidak membedakan "query benar, datanya belum ada" dari "query
 *     salah", jadi database-nya harus bisa diarahkan.
 *
 *   npm run dryrun:surat -- [nama-database] [no_surat|no_rawat]
 *
 * Aturan yang sama dengan `dryrun:bpjs` berlaku dan gampang dirusak: nama
 * database di-override SESUDAH `lib/env` memuat `.env`, lalu modulnya diimpor
 * DINAMIS. Mengubahnya jadi `import` biasa di puncak berkas membuat override-nya
 * tidak berpengaruh, dan gejalanya bukan galat melainkan hasil dari database
 * yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim, TIDAK menyentuh `.env`.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
if (dbArg && dbArg !== '-') process.env.SIK_DB_NAME = dbArg;

const kunciArg = process.argv[3];

function garis(judul: string) {
  console.log(`\n${'='.repeat(72)}\n${judul}\n${'='.repeat(72)}`);
}

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { cariSuratSakit, ambilSuratSakit, cariKunjunganSehat, ambilKunjunganSehat } = await import(
    '../src/khanza/suratPasien'
  );
  const { susunSuratSakit, susunSuratSehat, suratKeHtml, sertakanDiagnosa, bacaPesanPengantar } = await import(
    '../src/lib/surat'
  );
  const { htmlKePdf } = await import('../src/lib/pdf');
  const { namaBerkasSurat } = await import('../src/core/suratDoc');
  const { renderTemplate } = await import('../src/core/template');
  const { normalizePhone } = await import('../src/core/phone');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');

  console.log(`Database Khanza : ${sikDbConfig().database}`);
  const diagnosa = await sertakanDiagnosa();
  console.log(`Sertakan diagnosa: ${diagnosa ? 'YA' : 'tidak'} (administrasi.sertakan_diagnosa)`);

  const sampai = new Date();
  const dari = new Date();
  dari.setDate(dari.getDate() - 365);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const identitas = await getHospitalIdentity();
  const keluaran = path.resolve(process.cwd(), 'tmp-dryrun-surat');
  await mkdir(keluaran, { recursive: true });

  // -------------------------------------------------------------------------
  garis('SURAT KETERANGAN SAKIT');
  const daftarSakit = await cariSuratSakit(iso(dari), iso(sampai));
  console.log(`Ditemukan ${daftarSakit.length} surat dalam 365 hari terakhir.`);

  const pilihSakit = kunciArg
    ? daftarSakit.find((r) => r.no_surat === kunciArg)
    : daftarSakit[0];

  if (!pilihSakit) {
    console.log('(tidak ada surat sakit untuk dijadikan contoh)');
  } else {
    const row = await ambilSuratSakit(pilihSakit.no_surat, diagnosa);
    if (!row) {
      console.log(`(no_surat ${pilihSakit.no_surat} tidak terbaca ulang -- ini TIDAK normal)`);
    } else {
      // Membuktikan privasi pada OBJEK BARISNYA, bukan dengan membaca SQL --
      // pelajaran yang sama dengan `status_prb` pada surat kontrol BPJS.
      console.log(`Kolom yang benar-benar terbaca: ${Object.keys(row).join(', ')}`);
      const isi = susunSuratSakit(row);
      console.log(`\nno_surat   : ${isi.noSurat}`);
      console.log(`pasien     : ${isi.namaPasien} (RM ${isi.noRm})`);
      console.log(`istirahat  : ${isi.lamaSakit} hari, ${isi.tanggalAwal} s/d ${isi.tanggalAkhir}`);
      console.log(`diagnosa   : ${isi.diagnosa || '(tidak disertakan)'}`);
      console.log('baris identitas yang tercetak:');
      for (const b of isi.identitas.filter((x) => x.nilai)) console.log(`  ${b.label.padEnd(16)}: ${b.nilai}`);
      const dibuang = isi.identitas.filter((x) => !x.nilai).map((x) => x.label);
      if (dibuang.length) console.log(`baris DIBUANG karena kosong/penanda: ${dibuang.join(', ')}`);

      const pesan = renderTemplate(await bacaPesanPengantar('sakit'), {
        nama_pasien: isi.namaPasien,
        no_rm: isi.noRm,
        nama_rs: identitas.namaRs,
        kontak_rs: identitas.kontakRs,
      });
      console.log(`\npesan pengantar (${pesan.length} karakter):\n  ${pesan}`);
      const nomor = normalizePhone(row.no_tlp);
      console.log(
        `nomor tujuan: ${nomor.ok ? nomor.value : `(TIDAK TERPAKAI: ${nomor.reason} -- surat ini tidak akan terkirim)`}`,
      );

      const pdf = await htmlKePdf(await suratKeHtml(isi));
      const berkas = path.join(keluaran, namaBerkasSurat('sakit', isi.namaPasien));
      await writeFile(berkas, pdf);
      console.log(`\nPDF: ${berkas} (${pdf.byteLength} byte, magic ${pdf.subarray(0, 5).toString('latin1')})`);
    }
  }

  // -------------------------------------------------------------------------
  garis('SURAT KETERANGAN SEHAT');
  const dari30 = new Date();
  dari30.setDate(dari30.getDate() - 30);
  const daftarSehat = await cariKunjunganSehat(iso(dari30), iso(sampai));
  console.log(`Ditemukan ${daftarSehat.length} kunjungan dalam 30 hari terakhir.`);
  console.log('Catatan: Khanza tidak menyimpan baris surat sehat -- ia dicetak langsung dari kunjungan.');

  const pilihSehat = kunciArg ? daftarSehat.find((r) => r.no_rawat === kunciArg) : daftarSehat[0];
  if (!pilihSehat) {
    console.log('(tidak ada kunjungan untuk dijadikan contoh)');
  } else {
    const row = await ambilKunjunganSehat(pilihSehat.no_rawat);
    if (row) {
      console.log(`Kolom yang benar-benar terbaca: ${Object.keys(row).join(', ')}`);
      const isi = susunSuratSehat(row);
      console.log(`\nno_rawat   : ${row.no_rawat}`);
      console.log(`pasien     : ${isi.namaPasien} (RM ${isi.noRm})`);
      console.log(`kesimpulan : ${isi.kesimpulan || '(tidak tercatat -- surat memakai "SEHAT")'}`);
      console.log(`buta warna : ${isi.butaWarna || '(tidak tercatat -- kalimatnya dihilangkan)'}`);
      const pdf = await htmlKePdf(await suratKeHtml(isi));
      const berkas = path.join(keluaran, namaBerkasSurat('sehat', isi.namaPasien));
      await writeFile(berkas, pdf);
      console.log(`\nPDF: ${berkas} (${pdf.byteLength} byte, magic ${pdf.subarray(0, 5).toString('latin1')})`);
    }
  }

  await sik.close();
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
