/**
 * Pratinjau hasil lab, hasil radiologi, dan rincian tagihan sebagai BERKAS --
 * dan sekaligus membuktikan PDF-nya benar-benar terbentuk, tanpa mengirim apa
 * pun (migrations/038).
 *
 * Ada karena ketiga sakelarnya default MATI dan menyalakannya berarti berkas
 * berisi data medis seorang pasien berangkat ke nomor WhatsApp-nya. Satu-satunya
 * cara memeriksa isinya lebih dulu adalah menghasilkan berkasnya, dan itu
 * meluncurkan Chromium -- yang tidak boleh jadi bagian dari `poll:dryrun` yang
 * dijalankan rutin.
 *
 *   npm run dryrun:dokumen -- [nama-database] [no_rawat]
 *
 * Nama database bisa diarahkan dengan alasan yang sama seperti `dryrun:bpjs` dan
 * `dryrun:hibah`: `periksa_radiologi` dan `hasil_radiologi` KOSONG di kedua
 * database di mesin ini, jadi nol baris tidak membedakan "query benar, datanya
 * memang belum ada" dari "query salah".
 *
 * Aturan yang gampang dirusak dan sama untuk seluruh skrip dryrun: nama database
 * di-override SESUDAH `lib/env` memuat `.env`, lalu modulnya diimpor DINAMIS.
 * Mengubahnya jadi `import` biasa di puncak berkas membuat override-nya tidak
 * berpengaruh, dan gejalanya bukan galat melainkan hasil dari database yang
 * salah.
 *
 * TIDAK menulis ke outbox, TIDAK mengirim, TIDAK menyentuh `.env`.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
if (dbArg && dbArg !== '-') process.env.SIK_DB_NAME = dbArg;

const rawatArg = process.argv[3];

function garis(judul: string) {
  console.log(`\n${'='.repeat(72)}\n${judul}\n${'='.repeat(72)}`);
}

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik, sikSelect } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const { muatDokumen, dokumenKeBerkas, dokumenAktif, bacaPesanDokumen, rincianObatAktif } = await import(
    '../src/lib/dokumen'
  );
  const { namaBerkasDokumen } = await import('../src/core/dokumenDoc');
  const { renderTemplate } = await import('../src/core/template');
  const { normalizePhone } = await import('../src/core/phone');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');

  console.log(`Database Khanza : ${sikDbConfig().database}`);
  for (const j of ['lab', 'radiologi', 'nota'] as const) {
    console.log(`  dokumen ${j.padEnd(9)}: ${(await dokumenAktif(j)) ? 'AKTIF' : 'mati'}`);
  }
  console.log(`  rincian obat pada nota: ${(await rincianObatAktif()) ? 'DITAMPILKAN' : 'diringkas'}`);

  const identitas = await getHospitalIdentity();
  const keluaran = path.resolve(process.cwd(), 'tmp-dryrun-dokumen');
  await mkdir(keluaran, { recursive: true });

  async function cetak(isi: Awaited<ReturnType<typeof muatDokumen>>, jenis: 'lab' | 'radiologi' | 'nota') {
    if (!isi) {
      console.log('(kunjungan tidak ditemukan)');
      return;
    }
    const pesan = renderTemplate(await bacaPesanDokumen(jenis), {
      nama_pasien: isi.kepala.namaPasien,
      no_rm: isi.kepala.noRm,
      nama_rs: identitas.namaRs,
      alamat_rs: identitas.alamatRs,
      kontak_rs: identitas.kontakRs,
    });
    console.log(`\npesan pengantar (${pesan.length} karakter, batas keterangan 1024):\n  ${pesan}`);

    // Lewat `dokumenKeBerkas()` yang SAMA dipakai worker -- yang dilihat di sini
    // memang berkas yang akan diterima pasien.
    const hasil = await dokumenKeBerkas(isi);
    const tglIso = isi.kepala.tanggalRingkas.split('-').reverse().join('-');
    const berkas = path.join(keluaran, namaBerkasDokumen(jenis, tglIso));
    await writeFile(berkas, hasil.isi);
    const kepala = hasil.isi.subarray(0, 8).toString('latin1').replace(/[^ -~]/g, '.');
    console.log(`PDF: ${berkas} (${hasil.isi.byteLength} byte, mime ${hasil.mime}, awalan "${kepala}")`);
  }

  // -------------------------------------------------------------------------
  garis('HASIL LABORATORIUM');
  const lab = rawatArg
    ? await sikSelect<{ no_rawat: string; tgl_periksa: string }>(
        'SELECT no_rawat, tgl_periksa FROM periksa_lab WHERE no_rawat = :r ORDER BY tgl_periksa DESC LIMIT 1',
        { r: rawatArg },
      )
    : await sikSelect<{ no_rawat: string; tgl_periksa: string }>(
        'SELECT no_rawat, tgl_periksa FROM periksa_lab ORDER BY tgl_periksa DESC, jam DESC LIMIT 1',
      );
  if (!lab[0]) {
    console.log('(tidak ada baris periksa_lab)');
  } else {
    const isi = await muatDokumen({ jenis: 'lab', noRawat: lab[0].no_rawat, tglPeriksa: lab[0].tgl_periksa });
    if (isi && isi.jenis === 'lab') {
      console.log(`no_rawat : ${isi.kepala.noRawat}  tanggal ${isi.kepala.tanggalDokumen}`);
      console.log(`panel    : ${isi.kelompok.length}, parameter ${isi.kelompok.reduce((n, k) => n + k.baris.length, 0)}`);
      for (const k of isi.kelompok) {
        console.log(`  [${k.panel || '(tanpa nama panel)'}]`);
        for (const b of k.baris) {
          console.log(`    ${b.pemeriksaan.padEnd(28)} ${b.hasil.padStart(8)} ${b.satuan.padEnd(8)} rujukan ${b.rujukan}`);
        }
      }
      await cetak(isi, 'lab');
    }
  }

  // -------------------------------------------------------------------------
  garis('HASIL RADIOLOGI');
  const rad = await sikSelect<{ no_rawat: string; tgl_periksa: string }>(
    rawatArg
      ? 'SELECT no_rawat, tgl_periksa FROM hasil_radiologi WHERE no_rawat = :r ORDER BY tgl_periksa DESC LIMIT 1'
      : 'SELECT no_rawat, tgl_periksa FROM hasil_radiologi ORDER BY tgl_periksa DESC, jam DESC LIMIT 1',
    rawatArg ? { r: rawatArg } : {},
  );
  if (!rad[0]) {
    console.log('(tidak ada baris hasil_radiologi -- tabelnya KOSONG di alca maupun sik di mesin ini)');
    console.log('Arahkan ke database Khanza lain untuk membuktikan query-nya berjalan atas data sungguhan.');
  } else {
    const isi = await muatDokumen({ jenis: 'radiologi', noRawat: rad[0].no_rawat, tglPeriksa: rad[0].tgl_periksa });
    if (isi && isi.jenis === 'radiologi') {
      console.log(`no_rawat : ${isi.kepala.noRawat}  tanggal ${isi.kepala.tanggalDokumen}`);
      console.log(`pemeriksaan: ${isi.pemeriksaan.join(', ') || '(tidak tercatat)'}`);
      console.log(`bacaan     : ${isi.bacaan.length} blok, ${isi.bacaan.reduce((n, b) => n + b.teks.length, 0)} karakter`);
      await cetak(isi, 'radiologi');
    }
  }

  // -------------------------------------------------------------------------
  garis('RINCIAN TAGIHAN (NOTA)');
  const nota = await sikSelect<{ no_rawat: string; no_nota: string | null; tanggal: string }>(
    rawatArg
      ? 'SELECT no_rawat, no_nota, tanggal FROM nota_jalan WHERE no_rawat = :r LIMIT 1'
      : 'SELECT no_rawat, no_nota, tanggal FROM nota_jalan ORDER BY tanggal DESC, jam DESC LIMIT 1',
    rawatArg ? { r: rawatArg } : {},
  );
  if (!nota[0]) {
    console.log('(tidak ada baris nota_jalan)');
  } else {
    const isi = await muatDokumen({
      jenis: 'nota',
      noRawat: nota[0].no_rawat,
      noNota: nota[0].no_nota,
      tanggal: nota[0].tanggal,
      sumber: 'rajal',
    });
    if (isi && isi.jenis === 'nota') {
      console.log(`no_nota  : ${isi.noNota}  tanggal ${isi.kepala.tanggalDokumen}`);
      console.log(`poli     : ${isi.namaPoli}  cara bayar ${isi.caraBayar}`);
      console.log(`baris    : ${isi.baris.length}  (rincian obat ${isi.obatDiringkas ? 'DIRINGKAS' : 'ditampilkan'})`);
      for (const b of isi.baris) {
        const sisip = b.jenis === 'item' || b.jenis === 'keterangan' ? '    ' : '  ';
        console.log(
          `${sisip}${`[${b.jenis}] ${b.label}`.padEnd(58)} ${b.jumlah.padStart(4)} ${b.total.padStart(12)}`,
        );
      }
      if (isi.pembayaran.length) {
        console.log('pembayaran:');
        for (const p of isi.pembayaran) console.log(`  ${p.label.padEnd(24)} ${p.nilai}`);
      }
      await cetak(isi, 'nota');

      // Nomor tujuan diperiksa TERAKHIR dan hanya dilaporkan -- skrip ini tidak
      // pernah mengirim apa pun.
      const tlp = await sikSelect<{ no_tlp: string | null }>(
        'SELECT p.no_tlp FROM reg_periksa r LEFT JOIN pasien p ON p.no_rkm_medis = r.no_rkm_medis WHERE r.no_rawat = :r LIMIT 1',
        { r: nota[0].no_rawat },
      );
      const nomor = normalizePhone(tlp[0]?.no_tlp ?? null);
      console.log(`nomor tujuan: ${nomor.ok ? 'terpakai' : `TIDAK TERPAKAI (${nomor.reason})`}`);
    }
  }

  await sik.close();
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
