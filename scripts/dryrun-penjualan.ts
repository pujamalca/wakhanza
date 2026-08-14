/**
 * Pratinjau pemicu PENJUALAN terhadap database Khanza MANA PUN, dan sekaligus
 * pemeriksaan atas satu-satunya bagian fitur ini yang bisa mengirim pesan SALAH.
 *
 * Kenapa terpisah dari `poll:dryrun`: fitur ini punya DUA kejadian atas satu
 * baris yang sama, dan yang kedua -- pembatalan -- tidak bisa dipancing. Ia baru
 * muncul saat sebuah nota benar-benar dihapus di Khanza, kejadian yang terukur
 * 22 kali dalam dua setengah tahun. Menunggu kejadian aslinya berarti bentuk
 * pesannya pertama kali terlihat justru di grup, saat sudah terlambat.
 *
 *   npm run dryrun:penjualan -- [nama-database]
 *
 * Tanpa argumen, ia memakai database produksi (`SIK_DB_NAME`).
 *
 * Yang WAJIB diperhatikan kalau berkas ini diubah: nama database di-override
 * SESUDAH `lib/env` selesai memuat `.env` (yang MENIMPA process.env), lalu modul
 * yang membaca konfigurasi diimpor SECARA DINAMIS. Mengubah impor di dalam
 * main() menjadi `import` biasa di puncak berkas membuat override-nya tidak
 * berpengaruh sama sekali -- dan gejalanya bukan galat, melainkan hasil yang
 * diam-diam berasal dari database yang salah.
 *
 * TIDAK menulis ke outbox, TIDAK menyentuh buku pantau, TIDAK mengirim apa pun.
 */
import './../src/lib/env';

const dbArg = process.argv[2];
if (dbArg) process.env.SIK_DB_NAME = dbArg;

async function main() {
  const { sikDbConfig } = await import('../src/lib/env');
  const { sik } = await import('../src/db/sik');
  const { db } = await import('../src/db/wakhanza');
  const {
    pollPenjualanJendela,
    notaPenjualanYangAda,
    ambilRingkasPenjualan,
    ambilPenjualanTerpilih,
    ambilDetailPenjualan,
    JENDELA_PENJUALAN_PENUH,
  } = await import('../src/khanza/penjualan');
  const { kelompokkanDetailJual } = await import('../src/core/penjualan');
  const { susunVarsPenjualan, susunVarsPenjualanHapus, TRIGGER_PENJUALAN } = await import(
    '../src/worker/penjualanRunner'
  );
  const { bandingkanPantau } = await import('../src/core/pantauPenjualan');
  const { hitungJendelaPindai } = await import('../src/core/jendelaPindai');
  const { renderTemplate } = await import('../src/core/template');
  const { getSetting, getSettingBool, getSettingNumber, PenjualanPantau } = await import('../src/models');
  const { getHospitalIdentity } = await import('../src/khanza/common');
  const { identityVars, loadUniqueCodeTemplate } = await import('../src/worker/pipeline');
  const { appendUniqueCode } = await import('../src/core/uniqueCode');
  const { buildIdempotencyKey } = await import('../src/core/idempotency');

  console.log(`=== dryrun:penjualan terhadap database "${sikDbConfig().database}" -- tidak menulis apa pun ===\n`);

  const kutip = (teks: string) => teks.replace(/^/gm, '  | ');

  try {
    const sertakanHarga = await getSettingBool('farmasi.penjualan_harga', true);
    const lookback = await getSettingNumber('farmasi.penjualan_lookback_hari', 7);

    /**
     * DUA jendela dicetak, dan itu disengaja. Yang pertama adalah jendela yang
     * benar-benar dipakai worker -- jawaban atas "apakah ada yang akan terkirim
     * sekarang". Yang kedua jauh lebih lebar dan menjawab pertanyaan yang
     * berbeda: "apakah pemangkas prefiksnya benar". Tanpa yang kedua, nol baris
     * pada jendela sempit tidak bisa dibedakan dari prefiks yang salah.
     */
    const jendela = hitungJendelaPindai(new Date(), lookback, null);
    const sempit = await pollPenjualanJendela(jendela.dari, jendela.sampai);
    console.log(`Jendela worker (${jendela.dari} .. ${jendela.sampai}): ${sempit.length} baris`);

    /**
     * Pembacaan luas ini TERPOTONG oleh `LIMIT` milik query-nya sendiri, dan itu
     * WAJIB dikatakan.
     *
     * Versi pertama skrip ini mencetak `luas.length` sebagai "seluruh riwayat".
     * Pada apotek ini angkanya keluar tepat 1.000 -- yang bukan jumlah notanya
     * (16.787) melainkan batas jendelanya, dan angka bulat itu terbaca seperti
     * hitungan sungguhan. Lebih buruk lagi, karena urutannya ASC, ia memuat nota
     * TERTUA; contoh yang dicetak lalu berasal dari 2024 alih-alih dari nota
     * terakhir yang baru saja dimasukkan orang -- persis yang ingin dicocokkan
     * dengan layar Khanza.
     *
     * Bentuk kegagalan yang sama sudah dibayar di `information_schema.TABLE_ROWS`
     * pada 030: angka yang tampak pasti padahal cuma perkiraan atau potongan.
     */
    const luas = await pollPenjualanJendela('2000-01-01', '2099-12-31');
    const terpotong = luas.length >= JENDELA_PENJUALAN_PENUH;
    console.log(
      `Pembacaan luas (2000-01-01 .. 2099-12-31): ${luas.length} baris` +
        (terpotong ? `  <- TERPOTONG di batas jendela (${JENDELA_PENJUALAN_PENUH}); ini nota TERTUA, bukan seluruhnya` : ''),
    );
    console.log(
      `Harga PER BARANG ikut dibaca: ${sertakanHarga ? 'ya' : 'TIDAK (farmasi.penjualan_harga mati)'}` +
        '  -- kelima angka header selalu dibaca\n',
    );

    if (luas.length === 0) {
      console.log('Tidak ada satu pun nota penjualan di database ini.');
      console.log('Arahkan ke database lain:  npm run dryrun:penjualan -- <nama-database-lain>');
      console.log('');
      console.log('CATATAN: jangan menyimpulkan "kosong" dari information_schema.TABLE_ROWS --');
      console.log('nilainya PERKIRAAN pada InnoDB dan membulat ke nol pada tabel kecil.');
      return;
    }

    const body = (await getSetting('farmasi.template_penjualan', '')) ?? '';
    const bodyHapus = (await getSetting('farmasi.template_penjualan_hapus', '')) ?? '';
    const idVars = identityVars(await getHospitalIdentity());
    const kodeTemplate = await loadUniqueCodeTemplate();

    /**
     * Contoh diambil dari jendela WORKER lebih dulu, bukan dari pembacaan luas.
     *
     * Yang paling berguna dicocokkan dengan layar Khanza adalah nota yang baru
     * saja dimasukkan orang, dan pembacaan luas justru mengembalikan yang TERTUA
     * begitu ia terpotong `LIMIT`. Jendela worker jatuh ke pembacaan luas hanya
     * bila memang kosong -- keadaan yang wajar pada database arsip.
     */
    const contoh = (sempit.length > 0 ? sempit : luas).slice(-2);
    const nomor = contoh.map((h) => h.nota_jual);
    const [ringkas, terpilih, detail] = await Promise.all([
      ambilRingkasPenjualan(nomor),
      ambilPenjualanTerpilih(nomor),
      ambilDetailPenjualan(nomor, sertakanHarga),
    ]);
    const perNomor = kelompokkanDetailJual(detail);
    const ringkasPer = new Map(ringkas.map((r) => [r.nota_jual, r]));
    const terpilihPer = new Map(terpilih.map((t) => [t.nota_jual, t]));

    for (const h of contoh) {
      const rincian = perNomor.get(h.nota_jual) ?? [];
      const r = ringkasPer.get(h.nota_jual);
      const t = terpilihPer.get(h.nota_jual);
      console.log(`\n  --- ${h.nota_jual} | ${h.tgl_jual} | ${h.jns_jual} | ${h.status} | ${rincian.length} barang ---`);
      const bagian = susunVarsPenjualan(
        h,
        rincian,
        {
          jmlItem: r?.jml_item ?? null,
          subtotal: r?.subtotal ?? null,
          ppn: t?.ppn ?? null,
          ongkir: t?.ongkir ?? null,
          keterangan: t?.keterangan ?? null,
        },
        new Date(),
      );
      for (const [i, vars] of bagian.entries()) {
        const kunci = buildIdempotencyKey(TRIGGER_PENJUALAN, h.nota_jual, 'contoh@g.us');
        console.log(
          kutip(appendUniqueCode(renderTemplate(body, { ...idVars, ...vars }), kunci, kodeTemplate, new Date())),
        );
        if (i < bagian.length - 1) console.log('  | ...');
      }
    }

    /**
     * Pesan PEMBATALAN dirender di sini, dan inilah alasan utama skrip ini ada.
     * Tidak ada cara lain melihatnya tanpa menunggu sebuah nota benar-benar
     * dihapus di Khanza.
     */
    const contohHapus = contoh[contoh.length - 1];
    if (contohHapus && bodyHapus.trim()) {
      console.log(`\n  --- SEANDAINYA ${contohHapus.nota_jual} dihapus ---`);
      console.log(
        kutip(
          renderTemplate(bodyHapus, { ...idVars, ...susunVarsPenjualanHapus(contohHapus.nota_jual, new Date()) }),
        ),
      );
    } else if (!bodyHapus.trim()) {
      console.log('\n  (isi pesan pembatalan masih kosong -- isi di /farmasi?tab=penjualan)');
    }

    /**
     * Pagar privasi diperiksa pada OBJEK BARISNYA, bukan dengan membaca SQL.
     *
     * Ini pemeriksaan terpenting di skrip ini. Berbeda dari ketiga nota barang
     * lain, `penjualan` PUNYA `no_rkm_medis` dan `nm_pasien` -- jadi ketiadaannya
     * di sini bukan kepastian dari bentuk tabel melainkan hasil dari daftar
     * SELECT, dan daftar itu bisa diubah siapa saja yang menyentuh query-nya.
     */
    const kolomHeader = Object.keys(luas[0] ?? {});
    const kolomDetail = Object.keys(detail[0] ?? {});
    const kolomTerpilih = Object.keys(terpilih[0] ?? {});
    console.log(`\n  kolom header yang benar-benar terbaca : ${kolomHeader.join(', ')}`);
    console.log(`  kolom rincian yang benar-benar terbaca: ${kolomDetail.join(', ')}`);
    console.log(`  kolom nota terpilih yang terbaca      : ${kolomTerpilih.join(', ')}`);

    /**
     * Identitas pembeli dan dosis dilarang di KETIGA pembacaan, tanpa kecuali.
     */
    const terlarang = ['no_rkm_medis', 'nm_pasien', 'nama_bayar', 'aturan_pakai'];
    const bocor = [...kolomHeader, ...kolomDetail, ...kolomTerpilih].filter((k) => terlarang.includes(k));

    /**
     * `keterangan` punya pagarnya SENDIRI, dan bentuknya dua arah.
     *
     * Ia boleh -- dan harus -- ada di pembacaan nota terpilih; itu yang membuat
     * `{keterangan}` terisi. Tapi ia TIDAK BOLEH ada di jendela pindai, karena di
     * sanalah teks bebas kasir akan menyeberang untuk ratusan nota tiap siklus
     * padahal yang dipakai paling banyak sekuota.
     *
     * Ketiadaannya di tempat yang benar juga diperiksa, bukan cuma keberadaannya
     * di tempat yang salah: kolom yang diam-diam hilang dari daftar SELECT
     * menghasilkan `{keterangan}` yang kosong SELAMANYA tanpa satu pun galat --
     * dan itu tidak bisa dibedakan dari nota yang keterangannya memang kosong.
     */
    const ketDiJendela = [...kolomHeader, ...kolomDetail].includes('keterangan');
    const ketDiTerpilih = kolomTerpilih.includes('keterangan');
    console.log(
      bocor.length === 0
        ? '  PAGAR PRIVASI OK -- tidak satu pun kolom identitas pembeli terbaca'
        : `  *** PAGAR PRIVASI BOCOR: ${bocor.join(', ')} -- lihat komentar pembuka khanza/penjualan.ts ***`,
    );
    console.log(
      ketDiJendela
        ? '  *** keterangan BOCOR ke jendela pindai -- ia hanya boleh dibaca lewat ambilPenjualanTerpilih ***'
        : ketDiTerpilih || terpilih.length === 0
          ? '  keterangan OK -- hanya terbaca untuk nota yang benar-benar dikirim'
          : '  *** keterangan HILANG dari pembacaan nota terpilih -- {keterangan} akan kosong selamanya ***',
    );
    if (bocor.length > 0 || ketDiJendela || (terpilih.length > 0 && !ketDiTerpilih)) process.exitCode = 1;

    /**
     * Ketepatan pemangkasnya, dicetak sebagai angka supaya tidak perlu dipercaya
     * begitu saja. Di sini prefiks terbukti EKSAK (16.787/16.787 di produksi),
     * dan angka ini yang membuktikannya tetap begitu pada database mana pun.
     */
    let cocok = 0;
    let beda = 0;
    for (const h of luas) {
      const dariNomor = h.nota_jual.slice(2, 10); // YYYYMMDD
      const dariKolom = (h.tgl_jual ?? '').replace(/-/g, '');
      if (dariNomor === dariKolom) cocok++;
      else beda++;
    }
    console.log(`\n  prefiks nomor vs kolom tgl_jual: ${cocok} cocok, ${beda} berbeda (dari ${luas.length})`);

    /**
     * Deteksi pembatalan dijalankan KERING terhadap buku pantau yang sungguhan:
     * nol baris di sini berarti fiturnya belum pernah mengabarkan apa pun, jadi
     * belum ada yang bisa dilaporkan hilang. Itu keadaan yang benar untuk fitur
     * yang sakelarnya masih mati, dan mengatakannya membedakan "belum jalan"
     * dari "jalan tapi tidak menemukan apa-apa".
     */
    const batas = {
      awal: `PJ${jendela.dari.replace(/-/g, '')}000`,
      akhir: `PJ${jendela.sampai.replace(/-/g, '')}999`,
    };
    const hadir = await notaPenjualanYangAda(jendela.dari, jendela.sampai);
    const pantau = await PenjualanPantau.findAll();
    const dalamJendela = pantau.filter((p) => p.notaJual >= batas.awal && p.notaJual <= batas.akhir);
    const hasil = bandingkanPantau({
      hadir,
      pantau: dalamJendela.map((p) => ({ notaJual: p.notaJual, generasi: p.generasi, hapusAt: p.hapusAt })),
      jendela: batas,
    });
    const sejak = (await getSetting('farmasi.penjualan_sejak', '')) ?? '';
    console.log(
      `\n  buku pantau: ${pantau.length} baris (${dalamJendela.length} di dalam jendela)` +
        `\n  bila worker jalan sekarang: ${hasil.baru.length} nota baru, ${hasil.terhapus.length} pembatalan`,
    );
    /**
     * Angka di atas dihitung TANPA lantai aktivasi (jendela di skrip ini sengaja
     * memakai `sejak = null`), jadi ia menjawab "berapa yang ADA di jendela",
     * bukan "berapa yang akan terkirim". Tanpa keterangan ini, angka seratusan
     * pada fitur yang sakelarnya baru akan dinyalakan terbaca sebagai seratusan
     * pesan yang segera berangkat -- padahal lantainya memotongnya jadi nota
     * sejak hari aktivasi saja.
     */
    console.log(
      sejak
        ? `  (lantai aktivasi ${sejak} TIDAK diterapkan pada angka di atas -- yang benar-benar terkirim hanya nota bernomor sejak tanggal itu)`
        : '  (lantai aktivasi belum ada -- ditulis saat sakelarnya dinyalakan, dan sejak itu nota lama tidak ikut terkirim)',
    );
    if (hasil.terhapus.length > 0) {
      console.log(`  nota yang akan dikabarkan dibatalkan: ${hasil.terhapus.join(', ')}`);
    }

    /* ====================================================================
     * REKAP HARIAN (migrations/041)
     *
     * Ditumpangkan ke skrip ini, bukan dibuat skrip sendiri: ia membaca tabel
     * yang sama, tunduk pagar privasi yang sama, dan yang paling sering ingin
     * dibandingkan orang justru KEDUANYA berdampingan -- "kalau saya matikan
     * nota per transaksi dan pakai rekap saja, apa yang saya terima".
     * ==================================================================== */
    const { rekapPenjualanHarian } = await import('../src/khanza/penjualan');
    const { gabungRekap } = await import('../src/core/penjualanRekap');
    const { susunVarsRekap } = await import('../src/worker/penjualanRekapRunner');
    const { hariRekap } = await import('../src/core/penjualanRekap');

    const sekarang = new Date();
    const offsetRekap = await getSettingNumber('farmasi.penjualan_rekap_offset_hari', 0);
    const tanggalRekap = hariRekap(sekarang, offsetRekap);

    console.log(`\n=== REKAP HARIAN -- tanggal ${tanggalRekap} (offset ${offsetRekap} hari) ===`);

    const agregat = await rekapPenjualanHarian(tanggalRekap);

    /**
     * PAGAR PRIVASI, diperiksa pada `Object.keys()` baris HASILNYA -- bukan
     * dengan membaca SQL.
     *
     * Agregat memang tidak menyebut siapa pun, dan justru karena itu godaan
     * melonggarkan daftar SELECT-nya paling besar di sini. Yang menjaga tetap
     * kolom yang tidak pernah diambil (§5.2), jadi pemeriksaannya sama ketat
     * dengan yang dijalankan atas nota per transaksi di atas.
     *
     * `keterangan` TETAP terlarang di sini, dan itu bukan kelalaian menyalin
     * daftar lama: ia boleh dibaca per NOTA karena di sana ia keterangan satu
     * transaksi yang dilihat gudang. Pada agregat sehari tidak ada satu nota pun
     * untuk diambil keterangannya, dan menggabungkan ratusan keterangan adalah
     * cara paling cepat memindahkan seluruh teks bebas kasir ke satu pesan.
     */
    const TERLARANG = ['no_rkm_medis', 'nm_pasien', 'keterangan', 'nama_bayar', 'aturan_pakai'];
    const kolomRekap = [
      ...new Set([
        ...(agregat.header[0] ? Object.keys(agregat.header[0]) : []),
        ...(agregat.item[0] ? Object.keys(agregat.item[0]) : []),
      ]),
    ];
    const bocorRekap = kolomRekap.filter((k) => TERLARANG.includes(k));
    console.log(`  kolom terbaca: ${kolomRekap.length > 0 ? kolomRekap.join(', ') : '(tidak ada baris)'}`);
    console.log(
      bocorRekap.length === 0
        ? '  [ok] tidak ada kolom pasien/keterangan/dosis yang terbaca'
        : `  [BOCOR] kolom terlarang terbaca: ${bocorRekap.join(', ')}`,
    );
    if (bocorRekap.length > 0) process.exitCode = 1;

    const ringkasRekap = gabungRekap(agregat.header, agregat.item);
    console.log(
      `  ${ringkasRekap.jmlNota} nota, ${ringkasRekap.jmlBaris} baris, ${ringkasRekap.jmlBarang} barang; ` +
        `subtotal ${ringkasRekap.subtotal}, penyesuaian ${ringkasRekap.penyesuaian}, ppn ${ringkasRekap.ppn}, total ${ringkasRekap.total}`,
    );

    const bodyRekap = (await getSetting('farmasi.template_penjualan_rekap', '')) ?? '';
    const bodyRekapKosong = (await getSetting('farmasi.template_penjualan_rekap_kosong', '')) ?? '';
    const dipakai = ringkasRekap.kosong ? (bodyRekapKosong.trim() ? bodyRekapKosong : null) : bodyRekap;

    if (dipakai === null) {
      console.log(
        '\n  Hari itu tidak ada penjualan, dan "pesan saat kosong" dibiarkan kosong -- jadi sistem sengaja DIAM.',
      );
    } else {
      const teksRekap = appendUniqueCode(
        renderTemplate(dipakai, { ...idVars, ...susunVarsRekap(ringkasRekap, tanggalRekap, sekarang) }),
        buildIdempotencyKey('FARMASI_PENJUALAN_REKAP', tanggalRekap, 'contoh@g.us'),
        kodeTemplate,
        sekarang,
      );
      console.log(`\n${teksRekap}\n`);
    }
  } finally {
    await sik.close();
    await db.close();
  }
}

main().catch((err) => {
  console.error('[dryrun:penjualan] gagal:', err);
  process.exit(1);
});
