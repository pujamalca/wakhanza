'use server';

import { revalidatePath } from 'next/cache';
import { AdministrasiTarget, logAudit, setSetting, getSetting } from '@/models';
import { findUnknownVariables, REKAP_ADM_BULANAN_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { bacaJamRekap, tulisJamRekap } from '@/core/rekapJadwal';
import {
  bacaTanggalKirim,
  bulanRekap,
  labelBulan,
  TANGGAL_KIRIM_MIN,
  TANGGAL_KIRIM_MAKS,
} from '@/core/rekapBulan';
import { parseTarget, type JenisTarget } from '@/core/farmasiTarget';
import {
  susunRekapAdmBulanan,
  muatTargetAdmBulanan,
  KUNCI_TINDAKAN_KECUALI,
} from '@/worker/administrasiBulananRunner';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { buildIdempotencyKey } from '@/core/idempotency';
import { getHospitalIdentity } from '@/khanza/common';
import { mintaSyncGrup } from '@/lib/waGroups';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk tab REKAP BULANAN di `/administrasi?tab=bulanan` (migrations/047).
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan `bulananActions.ts`
 * dari `actions.ts` di `/farmasi`: batasnya bukan panjang melainkan pertanyaan
 * yang dijawab. Kesembilan aksi di `actions.ts` halaman ini mengirim BERKAS ke
 * seorang PASIEN; yang di sini mengirim satu pesan berisi ANGKA ke grup STAF,
 * dengan sakelar, jadwal, dan daftar tujuannya sendiri.
 */

export interface HasilBulanan {
  error?: string;
  sukses?: string;
}

export interface HasilPratinjauBulanan {
  error?: string;
  teks?: string;
  /** Bulan yang dibaca -- WAJIB ditampilkan, lihat pratinjaunya di bawah. */
  bulan?: string;
  jumlahKunjungan?: number;
  /**
   * Bulan itu tidak ada SATU PUN kunjungan DAN pesan kosongnya sengaja dibiarkan
   * diam. Bukan galat, tapi harus dikatakan -- kalau tidak, pratinjau yang tidak
   * menampilkan apa pun terbaca sebagai fitur yang rusak.
   */
  diam?: boolean;
}

function segarkan(): void {
  revalidatePath('/administrasi');
}

/**
 * Sakelar rekap bulanan, dicatat sebagai peristiwa audit tersendiri.
 *
 * BERDIRI SENDIRI dari `administrasi.enabled`, dan alasannya lebih kuat daripada
 * pemisahan mana pun di 041/042/046: sakelar itu menyalakan pengiriman BERKAS PDF
 * berisi nama, umur, dan alamat pasien ke nomor WhatsApp -- keputusan terberat di
 * halaman ini. Menjadikan rekap bertingkat di bawahnya berarti memaksa RS
 * mengambil keputusan itu hanya untuk mendapat satu pesan berisi ANGKA.
 *
 * TANPA lantai aktivasi. Lantai ada untuk menahan ARSIP -- pemicu kelas pindai
 * membaca jendela berhari-hari ke belakang, jadi menyalakannya tanpa lantai
 * membongkar seluruh isinya sekaligus. Rekap ini hanya pernah membaca SATU bulan,
 * yaitu bulan sebelum bulan berjalan, jadi tidak ada arsip yang bisa terbongkar.
 * Pagar yang tidak menahan apa pun mengajari pembacanya bahwa pagar boleh
 * dekoratif.
 */
export async function toggleBulananAction(enabled: boolean): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  await setSetting('administrasi.bulanan_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'administrasi_bulanan_toggle',
    'administrasi.bulanan_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

export async function simpanBulananAction(
  _prev: HasilBulanan,
  formData: FormData,
): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const tanggalRaw = String(formData.get('bulanan_tanggal') ?? '');
  const jamRaw = String(formData.get('bulanan_jam') ?? '');
  const template = String(formData.get('template_bulanan') ?? '');
  const templateKosong = String(formData.get('template_bulanan_kosong') ?? '');

  /**
   * Kotak centang "kecualikan tindakan".
   *
   * `getAll()`, bukan `get()` -- `CheckboxList` merender satu input per pilihan
   * dengan `name` yang sama. Yang tidak tercentang tidak terkirim sama sekali,
   * jadi tidak ada nilai kosong yang perlu disaring; `filter` di bawah menjaga
   * bentuk yang datang dari luar form.
   *
   * Uniknya lewat `Set` supaya nilai kembar tidak menggandakan barisnya di JSON
   * yang tersimpan. `sort()` supaya nilai tersimpannya STABIL: tanpa itu, dua
   * penyimpanan yang isinya sama persis menghasilkan dua string berbeda, dan
   * jejak `audit_log` berbunyi "berubah" pada perubahan yang tidak ada.
   */
  const tindakanKecuali = [
    ...new Set(
      formData
        .getAll('tindakan_kecuali')
        .map((v) => String(v).trim())
        .filter((v) => v !== ''),
    ),
  ].sort();

  /**
   * Tanggal dan jam ditolak di DEPAN orang yang bisa memperbaikinya seketika.
   *
   * Worker sengaja lebih pemaaf (jatuh ke bawaan berikut `warn`), dan pembagian
   * itu disengaja: di sini ada manusia yang menunggu jawaban, di sana tidak ada
   * siapa-siapa pukul delapan pagi tanggal 3.
   */
  const tanggal = bacaTanggalKirim(tanggalRaw);
  if (tanggal === null) {
    return {
      error:
        `Tanggal kirim harus antara ${TANGGAL_KIRIM_MIN} dan ${TANGGAL_KIRIM_MAKS}. ` +
        'Tanggal 29-31 tidak dipakai karena Februari tidak punya tanggal itu — jadwalnya akan melewatkan satu bulan setiap tahun.',
    };
  }

  const jam = bacaJamRekap(jamRaw);
  if (!jam) {
    return { error: 'Jam kirim harus berbentuk HH:MM, mis. 08:00.' };
  }

  if (!template.trim()) {
    return { error: 'Isi pesan rekap tidak boleh kosong — tanpa itu rekap terkirim sebagai pesan hampa.' };
  }

  // Ditolak SAAT DISIMPAN, bukan saat kirim (ARCHITECTURE §5.3).
  for (const [nama, isi] of [
    ['Isi pesan rekap', template],
    ['Isi pesan saat bulan kosong', templateKosong],
  ] as const) {
    if (!isi.trim()) continue;
    const takDikenal = findUnknownVariables(isi, REKAP_ADM_BULANAN_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${REKAP_ADM_BULANAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('administrasi.bulanan_tanggal', String(tanggal));
  await setSetting('administrasi.bulanan_jam', tulisJamRekap(jam));
  await setSetting('administrasi.template_bulanan', template);
  await setSetting('administrasi.template_bulanan_kosong', templateKosong);
  await setSetting(KUNCI_TINDAKAN_KECUALI, JSON.stringify(tindakanKecuali));
  /**
   * Kodenya IKUT dicatat, bukan cuma jumlahnya.
   *
   * `audit_log` append-only, jadi ia satu-satunya tempat yang bisa menjawab
   * "sejak kapan tindakan ini berhenti disebut di rekap" -- pertanyaan yang
   * pasti muncul saat seseorang membandingkan rekap dua bulan lalu dengan rekap
   * bulan ini dan menemukan satu baris hilang. Kodenya pendek dan jumlahnya
   * belasan, jadi ongkosnya nol.
   */
  await logAudit(
    session!.user.username,
    'administrasi_bulanan_pesan',
    'administrasi.template_bulanan',
    `tanggal ${tanggal} pukul ${tulisJamRekap(jam)}; pesan saat kosong: ${templateKosong.trim() ? 'diisi' : 'diam'}; ` +
      `tindakan dikecualikan: ${tindakanKecuali.length === 0 ? 'tidak ada' : `${tindakanKecuali.length} (${tindakanKecuali.join(', ')})`}`,
  );
  segarkan();
  return {
    sukses:
      `Pengaturan rekap bulanan tersimpan. Kiriman berikutnya tanggal ${tanggal} pukul ${tulisJamRekap(jam)}.` +
      (tindakanKecuali.length > 0
        ? ` ${tindakanKecuali.length} jenis tindakan dilipat jadi satu baris — jumlahnya tetap terhitung di total.`
        : ''),
  };
}

/**
 * Pratinjau rekap atas bulan yang BENAR-BENAR akan dibaca worker.
 *
 * Memakai `susunRekapAdmBulanan()` yang SAMA dipakai worker, dan membaca nilai
 * TERSIMPAN -- bukan isi kotak yang sedang diketik. Yang perlu dibuktikan staf
 * adalah apa yang akan dikirim WORKER, dan worker membaca `app_setting`.
 *
 * Bulan yang dibaca WAJIB ikut ditampilkan: rekap yang isinya mengejutkan tidak
 * bisa dibedakan dari query yang salah tanpa mengetahui periodenya.
 */
export async function pratinjauBulananAction(
  _prev: HasilPratinjauBulanan,
  _formData: FormData,
): Promise<HasilPratinjauBulanan> {
  const { response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const template = await getSetting('administrasi.template_bulanan', '');
  if (!template?.trim()) return { error: 'Isi pesan rekap masih kosong. Simpan isi pesannya lebih dulu.' };

  const sekarang = new Date();
  const bulan = bulanRekap(sekarang);

  try {
    const hasil = await susunRekapAdmBulanan(bulan, sekarang);
    if (hasil.body === null) {
      return { bulan, jumlahKunjungan: 0, diam: true };
    }

    /**
     * Identitas RS disisipkan sebagai DASAR, persis seperti `enqueueMessage`.
     * Tanpa ini `{nama_rs}` tampil kosong di pratinjau padahal terisi saat
     * benar-benar dikirim, dan staf yang melihatnya wajar menyimpulkan
     * variabelnya tidak jalan lalu membuangnya dari template.
     */
    const identitas = await getHospitalIdentity();
    const teks = renderTemplate(hasil.body, {
      nama_rs: identitas.namaRs,
      alamat_rs: identitas.alamatRs,
      kontak_rs: identitas.kontakRs,
      ...hasil.vars,
    });

    return { teks, bulan, jumlahKunjungan: hasil.ringkas.jmlKunjungan };
  } catch (err) {
    return { error: `Gagal membaca rekap bulanan: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Baris pertama pesan uji.
 *
 * WAJIB ada: tanpa itu, kiriman yang ditekan seseorang di tengah bulan tidak bisa
 * dibedakan dari rekap terjadwal oleh siapa pun yang membacanya -- dan pembacanya
 * akan menyimpulkan jadwalnya berubah, atau bahwa rekap tanggal 3 sudah lewat.
 */
const PENANDA_UJI =
  '*[UJI COBA]* Kiriman ini ditekan manual dari dasbor, bukan rekap terjadwal.\n' +
  'Isinya data sungguhan — silakan diperiksa, tapi jangan dianggap sebagai rekap resmi.';

/**
 * Kirim rekap UJI ke seluruh tujuan yang mencentang "terima rekap bulanan".
 *
 * Isinya rekap PRODUKSI, bukan kalimat contoh, dan alasannya satu angka: ia
 * berbunyi SEKALI SEBULAN. Kalau bentuk pesannya ternyata salah -- variabel yang
 * tidak terisi, angka yang tidak masuk akal, panjang yang tidak muat -- kesempatan
 * berikutnya datang tiga puluh hari lagi.
 *
 * `trigger_code` tetap `FARMASI_UJI` dan BUKAN `ADMINISTRASI_BULANAN`, dengan
 * alasan yang sudah dibayar di 044 dan 046: kunci idempoten rekap bulanan
 * berkunci pada BULAN, jadi kode pemicu sungguhan membuat uji tanggal 1
 * MEMBLOKIR rekap terjadwal tanggal 3 sebagai duplikat -- diam-diam, karena
 * INSERT-nya memang `ignoreDuplicates`. `FARMASI_UJI` juga sudah terdaftar
 * melewati jam tenang, sehingga tombol yang ditekan pukul 22.00 tetap
 * memperlihatkan hasilnya saat itu juga.
 */
export async function kirimUjiBulananAction(): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const tujuan = await muatTargetAdmBulanan();
  if (tujuan.length === 0) {
    return {
      error:
        'Belum ada tujuan yang mencentang “Terima rekap bulanan”. Centang dulu di daftar tujuan di atas — ' +
        'tanpa itu rekapnya tidak akan pergi ke mana pun, termasuk saat jatuh tempo.',
    };
  }

  const sekarang = new Date();
  const bulan = bulanRekap(sekarang);

  let hasil;
  try {
    hasil = await susunRekapAdmBulanan(bulan, sekarang);
  } catch (err) {
    return { error: `Gagal menyusun rekap: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (hasil.body === null) {
    return {
      error:
        `${labelBulan(bulan)} tidak punya satu pun kunjungan tercatat, sementara "Pesan saat bulan kosong" ` +
        'dikosongkan sehingga worker memang sengaja diam. Kalau bulan itu seharusnya berisi, yang perlu diperiksa ' +
        'bukan pesannya melainkan kenapa query-nya tidak membaca apa-apa.',
    };
  }
  if (!hasil.body.trim()) {
    return { error: 'Isi pesan rekap masih kosong. Simpan isi pesannya lebih dulu.' };
  }

  const body = `${PENANDA_UJI}\n\n${hasil.body}`;
  const ctx = await loadFarmasiContext('FARMASI_UJI', body, body);

  /**
   * Stempel waktu ikut ke kunci supaya tombolnya bisa ditekan BERULANG.
   *
   * Kebalikan dari jalur terjadwal, yang justru mengunci pada bulan supaya satu
   * bulan hanya pernah menghasilkan satu kiriman. Di sini pengirimnya manusia yang
   * sedang membetulkan sesuatu, dan menolak percobaan kedua sebagai duplikat
   * berarti staf menekan tombol, halaman menjawab berhasil, dan tidak ada apa pun
   * yang terkirim.
   */
  const stempel = sekarang.toISOString();
  for (const t of tujuan) {
    await enqueueMessage(
      {
        idempotencyKey: buildIdempotencyKey('FARMASI_UJI', t.chatId, bulan, stempel),
        noRkmMedis: null,
        rawPhone: null,
        chatId: t.chatId,
        eventAt: sekarang,
        vars: hasil.vars,
      },
      ctx,
    );
  }

  const r = hasil.ringkas;
  await logAudit(
    session!.user.username,
    'administrasi_bulanan_uji',
    bulan,
    `${labelBulan(bulan)}: ${r.jmlKunjungan} kunjungan, ${r.jmlPasien} pasien, ${tujuan.length} tujuan`,
  );
  segarkan();

  return {
    sukses:
      `Rekap ${labelBulan(bulan)} diantrekan ke ${tujuan.length} tujuan (${tujuan.map((t) => t.label).join(', ')}) — ` +
      `${r.jmlKunjungan} kunjungan, ${r.jmlPasien} pasien, ${r.jmlBaruTanpaAsesmen} asesmen belum diisi. ` +
      'Pastikan ia benar-benar muncul di sana.',
  };
}

/* ==========================================================================
 * TUJUAN
 * ==========================================================================
 *
 * Tabel TERSENDIRI (`administrasi_target`), bukan menumpang `farmasi_target` --
 * alasannya di migrations/047. Yang layak diingat saat membaca aksi-aksi di
 * bawah: halaman ini sampai migrasi itu TIDAK PUNYA daftar tujuan sama sekali,
 * karena kesembilan kelas pemicunya berujung ke nomor seorang PASIEN.
 *
 * Validasi alamatnya dipakai bersama (`core/farmasiTarget.ts`), dan itu
 * disengaja: yang dipakai bersama adalah cara membaca sebuah JID, bukan keputusan
 * tentang siapa yang menerima apa.
 */

export async function tambahTargetAction(_prev: HasilBulanan, form: FormData): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const jenis = String(form.get('jenis') ?? 'grup') as JenisTarget;
  const nilai = String(form.get('nilai') ?? '');
  const label = String(form.get('label') ?? '').trim();

  if (!label) return { error: 'Label wajib diisi.' };

  const hasil = parseTarget(jenis, nilai);
  if ('error' in hasil) return { error: hasil.error };

  const sudahAda = await AdministrasiTarget.findOne({ where: { chatId: hasil.chatId } });
  if (sudahAda) return { error: `Tujuan itu sudah terdaftar sebagai "${sudahAda.label}".` };

  await AdministrasiTarget.create({
    jenis: hasil.jenis,
    chatId: hasil.chatId,
    label,
    createdBy: session!.user.username,
  });
  await logAudit(session!.user.username, 'administrasi_target_tambah', hasil.chatId, label);
  segarkan();
  return { sukses: `Tujuan "${label}" ditambahkan. Centang "Terima rekap bulanan" supaya ia mulai menerimanya.` };
}

export async function toggleTargetAction(
  id: number,
  kolom: 'aktif' | 'bulanan',
  nilai: boolean,
): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const t = await AdministrasiTarget.findByPk(id);
  if (!t) return;

  if (kolom === 'aktif') t.isActive = nilai;
  else t.terimaBulanan = nilai;
  t.updatedBy = session!.user.username;
  t.updatedAt = new Date();
  await t.save();

  await logAudit(
    session!.user.username,
    'administrasi_target_ubah',
    t.chatId,
    `${kolom}=${nilai ? 'ya' : 'tidak'}`,
  );
  segarkan();
}

export async function hapusTargetAction(id: number): Promise<void> {
  const { session, response } = await requireRole('admin');
  if (response) return;

  const t = await AdministrasiTarget.findByPk(id);
  if (!t) return;
  const { chatId, label } = t;
  await t.destroy();
  await logAudit(session!.user.username, 'administrasi_target_hapus', chatId, label);
  segarkan();
}

/**
 * Minta worker membaca ulang daftar grup.
 *
 * Lewat `lib/waGroups.ts` yang SAMA dipakai `/farmasi`, `/bpjs`, `/erm`, dan
 * `/pesan-masuk` -- bukan penurunan keenam. Semuanya menulis `wa_session.command`,
 * dan lima tempat yang menyusunnya sendiri adalah lima kesempatan salah mengeja
 * satu nama perintah.
 */
export async function syncGrupAction(): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };
  const hasil = await mintaSyncGrup(session!.user.username);
  segarkan();
  return hasil;
}
