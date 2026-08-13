'use server';

import { revalidatePath } from 'next/cache';
import { ErmTarget, logAudit, setSetting, getSetting } from '@/models';
import { findUnknownVariables, REKAP_PENILAIAN_TEMPLATE_VARIABLES } from '@/core/template';
import { bacaSlotRekap, tulisSlotRekap } from '@/core/rekapJadwal';
import { KOLOM_INTI, type KolomInti } from '@/khanza/penilaianAwal';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import { buildIdempotencyKey, turunkanKunciBagian } from '@/core/idempotency';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { susunRekapPenilaian } from '@/worker/penilaianRunner';
import { hariRekap } from '@/core/rekapJadwal';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

const VARS_HINT = REKAP_PENILAIAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ');

export interface HasilForm {
  error?: string;
  sukses?: string;
}

function segarkan(): void {
  revalidatePath('/erm/penilaian-umum');
}

// ---------------------------------------------------------------------------
// Sakelar
// ---------------------------------------------------------------------------

/**
 * Sakelar utama ERM, dicatat `audit_log` sebagai peristiwanya sendiri -- pola
 * `farmasi_toggle` / `bpjs_toggle` / `auto_reply_toggle`.
 *
 * Alasannya sama, dan di sini lebih tajam: inilah momen daftar NAMA PASIEN mulai
 * mengalir ke sebuah grup WhatsApp. Menenggelamkannya sebagai satu nama kunci di
 * dalam `settings_update` membuat perubahan paling berkonsekuensi di halaman ini
 * jadi yang paling sulit ditelusuri belakangan.
 */
export async function toggleErmAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('erm.enabled', enabled ? '1' : '0');
  await logAudit(session!.user.username, 'erm_toggle', 'erm.enabled', enabled ? 'nyala' : 'mati');
  segarkan();
}

export async function togglePenilaianAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('erm.penilaian_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'erm_penilaian_toggle',
    'erm.penilaian_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

// ---------------------------------------------------------------------------
// Jadwal & isi pesan
// ---------------------------------------------------------------------------

export async function simpanPenilaianAction(_prev: HasilForm, form: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const jamRaw = String(form.get('jam') ?? '').trim();
  const offset = Number(form.get('offset') ?? '0');
  const maxBaris = Number(form.get('maxBaris') ?? '40');
  const rincian = String(form.get('rincian') ?? 'penuh');
  const poli = String(form.get('poli') ?? '').trim();
  const body = String(form.get('body') ?? '');
  const bodyKosong = String(form.get('bodyKosong') ?? '');
  const kolomInti = form.getAll('kolomInti').map(String);

  /**
   * Jam DITOLAK di sini, sementara worker justru jatuh ke bawaan.
   *
   * Pembagian yang disengaja: di sini ada orang di depan layar yang bisa
   * memperbaikinya seketika, jadi menolak adalah keterangan. Pukul tujuh malam
   * tanpa siapa-siapa, menolak diam berarti rekapnya berhenti selamanya tanpa
   * satu pun tanda. Pola yang sama dengan `bacaHariSebelum()`.
   */
  const slots = bacaSlotRekap(jamRaw);
  if (slots.length === 0) {
    return { error: 'Jam rekap tidak terbaca. Tulis dalam bentuk HH:MM, pisahkan dengan koma (mis. 13:00,19:30).' };
  }
  /**
   * Potongan yang DIBUANG wajib dikatakan, bukan disimpan diam-diam.
   *
   * `bacaSlotRekap` sengaja membuang yang tidak sah alih-alih menggugurkan
   * seluruh daftar -- benar untuk worker. Di sini, menyimpan hasil yang sudah
   * dipangkas tanpa memberitahu berarti staf mengetik tiga jam, melihat pesan
   * "tersimpan", lalu cuma dua yang pernah berbunyi.
   */
  const diminta = jamRaw.split(',').filter((s) => s.trim().length > 0).length;
  if (slots.length !== diminta) {
    return {
      error: `Ada ${diminta - slots.length} jam yang tidak terbaca. Tulis tiap jam dalam bentuk HH:MM (mis. 13:00,19:30).`,
    };
  }

  if (!Number.isInteger(offset) || offset < 0 || offset > 7) {
    return { error: 'Offset hari harus bilangan bulat 0-7.' };
  }
  if (!Number.isInteger(maxBaris) || maxBaris < 0 || maxBaris > 500) {
    return { error: 'Batas baris harus bilangan bulat 0-500 (0 = tanpa batas).' };
  }
  if (rincian !== 'penuh' && rincian !== 'ringkas') {
    return { error: 'Tingkat rincian tidak dikenal.' };
  }

  /**
   * Kolom inti disaring terhadap daftar-izin, dan kosong DITOLAK.
   *
   * Kosong akan membuat golongan "terisi sebagian" mustahil terjadi -- setiap
   * asesmen yang barisnya ada langsung dianggap lengkap. Itu bukan galat, cuma
   * separuh fiturnya mati tanpa satu pun tanda.
   */
  const sah = kolomInti.filter((k): k is KolomInti => (KOLOM_INTI as readonly string[]).includes(k));
  if (sah.length === 0) {
    return { error: 'Pilih minimal satu kolom yang harus terisi, kalau tidak setiap asesmen langsung dianggap lengkap.' };
  }

  const tidakDikenal = findUnknownVariables(body, REKAP_PENILAIAN_TEMPLATE_VARIABLES);
  if (tidakDikenal.length > 0) {
    return { error: `Variabel tidak dikenal: ${tidakDikenal.join(', ')}. Yang tersedia: ${VARS_HINT}` };
  }
  const tidakDikenalKosong = findUnknownVariables(bodyKosong, REKAP_PENILAIAN_TEMPLATE_VARIABLES);
  if (tidakDikenalKosong.length > 0) {
    return { error: `Variabel tidak dikenal di pesan "sudah lengkap": ${tidakDikenalKosong.join(', ')}` };
  }
  if (!body.trim()) {
    return { error: 'Isi pesan tidak boleh kosong -- rekapnya akan berangkat sebagai pesan hampa.' };
  }

  await Promise.all([
    setSetting('erm.penilaian_jam', tulisSlotRekap(slots)),
    setSetting('erm.penilaian_offset_hari', String(offset)),
    setSetting('erm.penilaian_max_baris', String(maxBaris)),
    setSetting('erm.penilaian_rincian', rincian),
    setSetting('erm.penilaian_kolom_inti', sah.join(',')),
    setSetting('erm.penilaian_poli', poli),
    setSetting('erm.template_penilaian', body),
    setSetting('erm.template_penilaian_kosong', bodyKosong),
  ]);

  await logAudit(
    session!.user.username,
    'erm_penilaian_simpan',
    'erm.penilaian_*',
    `jam ${tulisSlotRekap(slots)}, offset ${offset}, rincian ${rincian}, kolom ${sah.join('+')}`,
  );
  segarkan();
  return { sukses: 'Pengaturan rekap tersimpan.' };
}

// ---------------------------------------------------------------------------
// Tujuan
// ---------------------------------------------------------------------------

export async function tambahTargetAction(_prev: HasilForm, form: FormData): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const jenis = String(form.get('jenis') ?? 'grup') as JenisTarget;
  const nilai = String(form.get('nilai') ?? '');
  const label = String(form.get('label') ?? '').trim();

  if (!label) return { error: 'Label wajib diisi.' };

  const hasil = parseTarget(jenis, nilai);
  if ('error' in hasil) return { error: hasil.error };

  const sudahAda = await ErmTarget.findOne({ where: { chatId: hasil.chatId } });
  if (sudahAda) return { error: `Tujuan itu sudah terdaftar sebagai "${sudahAda.label}".` };

  await ErmTarget.create({
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
  });
  await logAudit(session!.user.username, 'erm_target_tambah', hasil.chatId, label);
  segarkan();
  return { sukses: `Tujuan "${label}" ditambahkan. Centang dulu supaya ia mulai menerima rekap.` };
}

export async function toggleTargetAction(id: number, kolom: 'aktif' | 'penilaian', nilai: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const t = await ErmTarget.findByPk(id);
  if (!t) return;

  if (kolom === 'aktif') t.isActive = nilai;
  else t.terimaPenilaianUmum = nilai;
  t.updatedBy = session!.user.username;
  t.updatedAt = new Date();
  await t.save();

  await logAudit(session!.user.username, 'erm_target_ubah', t.chatId, `${kolom}=${nilai ? 'ya' : 'tidak'}`);
  segarkan();
}

export async function hapusTargetAction(id: number): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const t = await ErmTarget.findByPk(id);
  if (!t) return;
  const { chatId, label } = t;
  await t.destroy();
  await logAudit(session!.user.username, 'erm_target_hapus', chatId, label);
  segarkan();
}

/**
 * Baris pembuka yang menandai kiriman ini sebagai UJI.
 *
 * WAJIB ada, dan bukan demi kesopanan: isinya rekap PRODUKSI yang sama persis
 * dengan yang berangkat pukul 13.00 dan 19.30, jadi tanpa penanda ini kiriman
 * yang ditekan seseorang pukul sepuluh pagi tidak bisa dibedakan dari rekap
 * terjadwal oleh siapa pun yang membacanya di grup. Perawat yang membacanya lalu
 * mengira jadwalnya berubah, atau mengira rekap 13.00 sudah lewat.
 *
 * Ia ikut ke SETIAP bagian dengan sendirinya, karena yang dipecah adalah
 * `{daftar_pasien}` sementara templatenya dirender ulang utuh per bagian.
 */
const PENANDA_UJI =
  '*[UJI COBA]* Kiriman ini ditekan manual dari dasbor, bukan rekap terjadwal.\n' +
  'Isinya data sungguhan hari ini -- silakan diperiksa, tapi jangan dianggap sebagai rekap resmi.';

/**
 * Kirim uji ke SATU tujuan -- REKAP SUNGGUHAN, bukan teks contoh.
 *
 * ==========================================================================
 * Kenapa isinya data produksi
 * ==========================================================================
 *
 * Tombol uji di `/farmasi`, `/bpjs`, dan `/template` semuanya mengirim kalimat
 * tetap ("kalau pesan ini terbaca, berarti tujuan ini sudah benar"). Itu benar
 * untuk apa yang mereka buktikan: ALAMATNYA. Kiriman ke JID grup yang sama
 * sekali tidak ada tetap berakhir `sent` tanpa galat apa pun, jadi satu-satunya
 * cara membuktikan sebuah kode grup benar adalah ada manusia yang melihat
 * pesannya muncul.
 *
 * Fitur ini menuntut lebih. Rekapnya berangkat sendiri dua kali sehari pada jam
 * yang dipilih staf, tanpa seorang pun meninjaunya, dan isinya DAFTAR NAMA
 * PASIEN. Kalimat tetap membuktikan alamatnya benar lalu diam soal pertanyaan
 * yang sebenarnya: apakah yang tiba di grup memang rekap yang dimaksud, dengan
 * angka yang benar, nama yang benar, dan panjang yang muat. Menunggu pukul 13.00
 * untuk mengetahuinya berarti kesalahan pertama ditemukan oleh penerimanya.
 *
 * Karena itu tombol ini memanggil `susunRekapPenilaian()` yang SAMA dipakai
 * worker, lalu mengirim SELURUH bagiannya -- bukan bagian pertama saja, kalau
 * tidak yang diuji bukan yang akan dikirim.
 *
 * ==========================================================================
 * Yang TETAP sama dengan tombol uji lain
 * ==========================================================================
 *
 * `trigger_code`-nya tetap `FARMASI_UJI`, bukan `ERM_PENILAIAN_UMUM`. Baris uji
 * berkode pemicu sungguhan akan tercampur dengan pengiriman sungguhan di Antrean
 * dan Ringkasan lalu ikut terhitung sebagai rekap yang benar-benar berangkat --
 * dan di sini akibatnya lebih jauh: penanda harian (`erm.penilaian_last_run`)
 * dan `uq_idem` berkunci pada slot, jadi kode sungguhan berarti uji pukul
 * sepuluh pagi bisa MEMBLOKIR rekap 13.00 sebagai duplikat. `FARMASI_UJI` juga
 * sudah terdaftar melewati jam tenang, sehingga tombol yang ditekan pukul 22.00
 * tetap memperlihatkan hasilnya saat itu juga.
 *
 * Kunci idempotennya memuat stempel waktu supaya bisa ditekan BERULANG: staf
 * yang sedang membetulkan kode grup harus bisa mencoba lagi.
 *
 * ==========================================================================
 * TANGGALNYA diserahkan halaman, bukan selalu hari ini
 * ==========================================================================
 *
 * Bentuk pertama memakai `hariRekap(sekarang, offset)` -- tanggal yang persis
 * dipakai worker. Terlihat paling benar, dan gagal pada hari yang paling
 * membutuhkannya: 13 Agustus 2026 punya 3 pendaftaran dan NOL di antaranya
 * berstatus `Baru`, jadi rekapnya sengaja diam dan tombol ujinya tidak punya apa
 * pun untuk dikirim. Hari seperti itu bukan kekecualian -- dan justru pada hari
 * tidak ada rekap yang datang itulah staf paling ingin membuktikan sistemnya
 * masih hidup.
 *
 * Karena itu tanggalnya diambil dari pemilih rentang yang SUDAH ada tepat di
 * atas tabel halaman ini. Staf melihat tabel 12 Agustus berisi sebelas pasien,
 * menekan tombol, dan yang berangkat adalah rekap sebelas pasien itu: apa yang
 * dilihat, itu yang dikirim. Tanpa argumen ia tetap jatuh ke tanggal worker.
 */
export async function kirimUjiAction(id: number, tanggalDiminta?: string): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const t = await ErmTarget.findByPk(id);
  if (!t) return { error: 'Tujuan tidak ditemukan.' };

  const sekarang = new Date();
  // Bentuknya diperiksa di server, tidak pernah dipercaya dari klien: nilainya
  // masuk ke prefix `no_rawat` di SQL.
  const sah = typeof tanggalDiminta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tanggalDiminta);
  const offsetRaw = Number((await getSetting('erm.penilaian_offset_hari', '0')) ?? '0');
  const tanggal = sah
    ? tanggalDiminta!
    : hariRekap(sekarang, Number.isFinite(offsetRaw) ? offsetRaw : 0);

  let hasil;
  try {
    hasil = await susunRekapPenilaian(tanggal, sekarang);
  } catch (e) {
    return { error: `Gagal menyusun rekap: ${(e as Error).message}` };
  }

  /**
   * Sengaja diam BUKAN kegagalan, tapi juga bukan sesuatu yang bisa dibuktikan
   * lewat pengiriman.
   *
   * Mengirim pesan hampa akan "berhasil" tanpa membuktikan apa pun, dan lebih
   * buruk: staf menyimpulkan tujuannya salah padahal justru tidak ada yang perlu
   * dikirim.
   *
   * KEDUA sebabnya dibedakan, walau `rekapKosong()` memperlakukannya sama.
   * Bagi worker keduanya memang setara -- tidak ada yang perlu dikerjakan
   * perawat. Bagi orang yang sedang menguji, "belum ada pasien baru sama sekali"
   * dan "ada, tapi semuanya sudah lengkap" menuntut tindakan yang berlawanan:
   * yang pertama pilih tanggal lain, yang kedua isi pesan "sudah lengkap".
   * Menggabungkannya jadi satu kalimat mengirim separuh orang ke arah yang salah.
   */
  if (hasil.body === null) {
    return {
      error:
        hasil.jumlah.total === 0
          ? `Tanggal ${tanggal} tidak punya satu pun pasien baru rawat jalan, jadi tidak ada rekap untuk dikirim. ` +
            'Pilih tanggal lain di kotak "Dari" tepat di atas tabel, lalu coba lagi.'
          : `Seluruh asesmen tanggal ${tanggal} sudah lengkap (${hasil.jumlah.lengkap} dari ${hasil.jumlah.total}), ` +
            'dan "Pesan saat semua lengkap" dikosongkan sehingga worker memang sengaja diam. ' +
            'Isi pesan itu dulu, atau pilih tanggal yang masih ada asesmen belum lengkap.',
    };
  }

  const body = `${PENANDA_UJI}\n\n${hasil.body}`;
  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);

  const stempel = sekarang.toISOString();
  for (const [i, vars] of hasil.bagian.entries()) {
    await enqueueMessage(
      {
        // `turunkanKunciBagian` MENGHASH ULANG, bukan menyambung: kolomnya
        // VARCHAR(64) sementara SHA1 hex sudah 40 karakter, dan sambungan yang
        // melewatinya dipotong DIAM oleh MariaDB non-strict tepat di bagian yang
        // membedakan satu bagian dari bagian lain (migrations/018).
        idempotencyKey: turunkanKunciBagian(
          buildIdempotencyKey('FARMASI_UJI', t.chatId, tanggal, stempel),
          i,
        ),
        noRkmMedis: null,
        rawPhone: null,
        chatId: t.chatId,
        eventAt: sekarang,
        vars,
      },
      ctx,
    );
  }

  await logAudit(
    session!.user.username,
    'erm_target_uji',
    t.chatId,
    `${t.label} -- rekap ${tanggal}: ${hasil.jumlah.total} pasien baru, ` +
      `${hasil.jumlah.belum} belum diisi, ${hasil.jumlah.sebagian} terisi sebagian, ` +
      `${hasil.bagian.length} bagian`,
  );
  segarkan();

  const rincianBagian = hasil.bagian.length > 1 ? ` dalam ${hasil.bagian.length} bagian` : '';
  return {
    sukses:
      `Rekap ${tanggal} diantrekan ke "${t.label}"${rincianBagian} — ` +
      `${hasil.jumlah.belum} belum diisi, ${hasil.jumlah.sebagian} terisi sebagian. ` +
      'Pastikan ia benar-benar muncul di sana.',
  };
}

export async function syncGrupAction(): Promise<HasilForm> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };
  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  return hasil;
}

// ---------------------------------------------------------------------------
// Pratinjau
// ---------------------------------------------------------------------------

/**
 * Merender rekap memakai `susunRekapPenilaian()` yang SAMA dipakai worker, dan
 * membaca nilai TERSIMPAN -- bukan isi kotak yang sedang diketik.
 *
 * Pilihan yang sama dengan tombol "Kirim peringatan uji" di `/pengaturan`: yang
 * perlu dibuktikan staf adalah apa yang akan dikirim WORKER, dan worker membaca
 * `app_setting`. Halamannya mengatakan ini supaya "kenapa suntingan saya belum
 * kelihatan" terjawab tanpa menebak.
 */
export async function pratinjauAction(): Promise<{ error?: string; teks?: string; bagian?: number }> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak berwenang.' };

  const sekarang = new Date();
  const offset = Number((await getSetting('erm.penilaian_offset_hari', '0')) ?? '0');
  const tanggal = hariRekap(sekarang, Number.isFinite(offset) ? offset : 0);

  try {
    const hasil = await susunRekapPenilaian(tanggal, sekarang);
    if (hasil.body === null) {
      return {
        teks:
          `(tidak ada pesan)\n\nSeluruh asesmen tanggal ${tanggal} sudah lengkap, ` +
          `dan "Pesan saat semua lengkap" dikosongkan -- jadi worker sengaja diam.`,
      };
    }
    const { renderTemplate } = await import('@/core/template');
    const teks = hasil.bagian
      .map((v, i) => (hasil.bagian.length > 1 ? `--- bagian ${i + 1} ---\n` : '') + renderTemplate(hasil.body!, v))
      .join('\n\n');
    return { teks, bagian: hasil.bagian.length };
  } catch (e) {
    return { error: `Gagal menyusun pratinjau: ${(e as Error).message}` };
  }
}
