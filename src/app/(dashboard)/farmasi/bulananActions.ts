'use server';

import { revalidatePath } from 'next/cache';
import { FarmasiTarget, logAudit, setSetting, getSetting } from '@/models';
import { findUnknownVariables, REKAP_BULANAN_TEMPLATE_VARIABLES, renderTemplate } from '@/core/template';
import { bacaJamRekap, tulisJamRekap } from '@/core/rekapJadwal';
import {
  bacaTanggalKirim,
  bulanRekap,
  labelBulan,
  TANGGAL_KIRIM_MIN,
  TANGGAL_KIRIM_MAKS,
} from '@/core/rekapBulan';
import { susunRekapBulanan, muatTargetBulanan } from '@/worker/farmasiBulananRunner';
import { loadFarmasiContext, enqueueMessage } from '@/worker/pipeline';
import { buildIdempotencyKey } from '@/core/idempotency';
import { getHospitalIdentity } from '@/khanza/common';
import { requireRole } from '@/lib/authz';

/**
 * Aksi untuk tab REKAP BULANAN di `/farmasi?tab=bulanan` (migrations/046).
 *
 * Berkas tersendiri, dengan alasan yang sama yang memisahkan
 * `resepRekapActions.ts` dari `actions.ts`: batasnya bukan panjang melainkan
 * pertanyaan yang dijawab. Ini kelas pemicu yang berbeda (waktu berperiode bulan)
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
  jumlahResep?: number;
  /**
   * Bulan itu tidak ada SATU PUN kegiatan farmasi DAN pesan kosongnya sengaja
   * dibiarkan diam. Bukan galat, tapi harus dikatakan -- kalau tidak, pratinjau
   * yang tidak menampilkan apa pun terbaca sebagai fitur yang rusak.
   */
  diam?: boolean;
}

function segarkan(): void {
  revalidatePath('/farmasi');
}

/**
 * Sakelar rekap bulanan, dicatat sebagai peristiwa audit tersendiri.
 *
 * BERDIRI SENDIRI dari `farmasi.enabled`, dengan alasan yang sudah dibayar di
 * rekap penjualan (041) dan rekap resep (042): sakelar itu menyalakan pesan yang
 * memuat NAMA PASIEN, NOMOR REKAM MEDIS, dan POLI ke sebuah grup WhatsApp.
 * Menjadikan rekap ini bertingkat di bawahnya berarti memaksa RS mengambil
 * keputusan privasi terberat di halaman ini hanya untuk mendapatkan satu pesan
 * berisi ANGKA.
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

  await setSetting('farmasi.bulanan_enabled', enabled ? '1' : '0');
  await logAudit(
    session!.user.username,
    'farmasi_bulanan_toggle',
    'farmasi.bulanan_enabled',
    enabled ? 'nyala' : 'mati',
  );
  segarkan();
}

/**
 * Centang "Terima rekap bulanan" pada satu tujuan.
 *
 * Tinggal di berkas ini, bukan di `actions.ts`, dengan alasan yang sama yang
 * menaruh `toggleTerimaPenjualanAction` di `penjualanActions.ts`: centang dan
 * fitur yang dilayaninya harus bisa dibaca berdampingan, kalau tidak keterangan
 * di keduanya cepat atau lambat menyimpang.
 */
export async function toggleTerimaBulananAction(id: number, terima: boolean): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const row = await FarmasiTarget.findByPk(id);
  if (!row) return { error: 'Tujuan tidak ditemukan.' };

  await row.update({ terimaBulanan: terima, updatedBy: session!.user.username, updatedAt: new Date() });
  await logAudit(
    session!.user.username,
    'farmasi_target_bulanan',
    String(id),
    `${row.jenis} ${row.chatId} -> ${terima ? 'menerima rekap bulanan' : 'tidak menerima rekap bulanan'}`,
  );
  segarkan();
  return {};
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
   * Tanggal dan jam ditolak di DEPAN orang yang bisa memperbaikinya seketika.
   *
   * Worker sengaja lebih pemaaf (jatuh ke bawaan berikut `warn`), dan pembagian
   * itu disengaja: di sini ada manusia yang menunggu jawaban, di sana tidak ada
   * siapa-siapa pukul delapan pagi tanggal 3. Pola yang sama dengan
   * `bacaHariSebelum()` pada pengingat kontrol.
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
    const takDikenal = findUnknownVariables(isi, REKAP_BULANAN_TEMPLATE_VARIABLES);
    if (takDikenal.length > 0) {
      return {
        error: `${nama}: variabel tidak dikenal ${takDikenal.map((v) => `{${v}}`).join(', ')}. Yang tersedia: ${REKAP_BULANAN_TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
      };
    }
  }

  await setSetting('farmasi.bulanan_tanggal', String(tanggal));
  await setSetting('farmasi.bulanan_jam', tulisJamRekap(jam));
  await setSetting('farmasi.template_bulanan', template);
  await setSetting('farmasi.template_bulanan_kosong', templateKosong);
  await logAudit(
    session!.user.username,
    'farmasi_bulanan_pesan',
    'farmasi.template_bulanan',
    `tanggal ${tanggal} pukul ${tulisJamRekap(jam)}; pesan saat kosong: ${templateKosong.trim() ? 'diisi' : 'diam'}`,
  );
  segarkan();
  return { sukses: `Pengaturan rekap bulanan tersimpan. Kiriman berikutnya tanggal ${tanggal} pukul ${tulisJamRekap(jam)}.` };
}

/**
 * Pratinjau rekap atas bulan yang BENAR-BENAR akan dibaca worker.
 *
 * Memakai `susunRekapBulanan()` yang SAMA dipakai worker, dan membaca nilai
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

  const template = await getSetting('farmasi.template_bulanan', '');
  if (!template?.trim()) return { error: 'Isi pesan rekap masih kosong. Simpan isi pesannya lebih dulu.' };

  const sekarang = new Date();
  const bulan = bulanRekap(sekarang);

  try {
    const hasil = await susunRekapBulanan(bulan, sekarang);
    if (hasil.body === null) {
      return { bulan, jumlahResep: 0, diam: true };
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

    return { teks, bulan, jumlahResep: hasil.ringkas.jmlResep };
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
 * ==========================================================================
 * Isinya rekap PRODUKSI, bukan kalimat contoh
 * ==========================================================================
 *
 * Tombol uji di tab lain halaman ini mengirim teks tetap ("kalau pesan ini
 * terbaca, berarti tujuan ini sudah benar"), dan itu benar untuk apa yang mereka
 * buktikan: ALAMATNYA -- kiriman ke JID grup yang sama sekali tidak ada tetap
 * berakhir `sent` tanpa galat apa pun, jadi harus ada manusia yang melihat
 * pesannya muncul.
 *
 * Fitur ini menuntut lebih, dan alasannya satu angka: ia berbunyi SEKALI SEBULAN.
 * Kalau bentuk pesannya ternyata salah -- variabel yang tidak terisi, angka yang
 * tidak masuk akal, panjang yang tidak muat -- kesempatan berikutnya datang tiga
 * puluh hari lagi. Kalimat tetap membuktikan alamatnya lalu diam soal pertanyaan
 * yang sebenarnya. Pratinjau menjawab isinya, tapi hanya di layar orang yang
 * menekannya; yang belum terjawab adalah apakah ia benar-benar TIBA, utuh, di
 * tempat yang dituju.
 *
 * Karena itu ia memanggil `susunRekapBulanan()` yang SAMA dipakai worker.
 *
 * ==========================================================================
 * `trigger_code` tetap `FARMASI_UJI`
 * ==========================================================================
 *
 * Bukan `FARMASI_BULANAN`, dan itu bukan kerapian: kunci idempoten rekap bulanan
 * berkunci pada BULAN (`FARMASI_BULANAN` + bulan + chat_id), jadi kode pemicu
 * sungguhan membuat uji tanggal 1 MEMBLOKIR rekap terjadwal tanggal 3 sebagai
 * duplikat -- diam-diam, karena INSERT-nya memang `ignoreDuplicates`. Kesalahan
 * yang tidak akan ketahuan sampai ada yang menyadari rekap bulan itu tidak pernah
 * datang.
 *
 * `FARMASI_UJI` juga sudah terdaftar melewati jam tenang, sehingga tombol yang
 * ditekan pukul 22.00 tetap memperlihatkan hasilnya saat itu juga.
 */
export async function kirimUjiBulananAction(): Promise<HasilBulanan> {
  const { session, response } = await requireRole('admin');
  if (response) return { error: 'Tidak diizinkan.' };

  const tujuan = await muatTargetBulanan();
  if (tujuan.length === 0) {
    return {
      error:
        'Belum ada tujuan yang mencentang “Terima rekap bulanan”. Centang dulu di tab Tujuan pengiriman — ' +
        'tanpa itu rekapnya tidak akan pergi ke mana pun, termasuk saat jatuh tempo.',
    };
  }

  const sekarang = new Date();
  const bulan = bulanRekap(sekarang);

  let hasil;
  try {
    hasil = await susunRekapBulanan(bulan, sekarang);
  } catch (err) {
    return { error: `Gagal menyusun rekap: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (hasil.body === null) {
    return {
      error:
        `${labelBulan(bulan)} tidak punya satu pun kegiatan farmasi — nol resep, nol pengadaan, nol pemesanan, ` +
        'nol hibah, dan nol penjualan — sementara "Pesan saat bulan kosong" dikosongkan sehingga worker memang ' +
        'sengaja diam. Isi pesan itu dulu kalau memang ingin tetap dikabari.',
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
   * bulan hanya pernah menghasilkan satu kiriman. Di sini pengirimnya manusia
   * yang sedang membetulkan sesuatu, dan menolak percobaan kedua sebagai duplikat
   * berarti staf menekan tombol, halaman menjawab berhasil, dan tidak ada apa pun
   * yang terkirim. Alasan yang sama sudah dibayar di tombol uji tujuan farmasi.
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
    'farmasi_bulanan_uji',
    bulan,
    `${labelBulan(bulan)}: ${r.jmlResep} resep, ${r.jmlPasien} pasien, ${r.penjualan.jml} nota jual, ` +
      `${tujuan.length} tujuan`,
  );
  segarkan();

  return {
    sukses:
      `Rekap ${labelBulan(bulan)} diantrekan ke ${tujuan.length} tujuan (${tujuan.map((t) => t.label).join(', ')}) — ` +
      `${r.jmlResep} resep, ${r.jmlBelumSerah} belum diserahkan, ${r.jmlTanpaTelaah} belum ditelaah. ` +
      'Pastikan ia benar-benar muncul di sana.',
  };
}
