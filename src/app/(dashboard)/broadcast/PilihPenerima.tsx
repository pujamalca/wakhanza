import Link from 'next/link';
import { MAX_PILIHAN_PASIEN, pilihanTersembunyi, type ModePenerima } from '@/core/pilihanPasien';
import { hrefTanpa } from '@/core/hrefFilter';
import { Button, cellClass } from '@/components/ui';

/**
 * Kendali "siapa yang dikirimi", dipakai BERSAMA /broadcast dan
 * /broadcast-terjadwal.
 *
 * Ditulis sekali karena kedua halaman menawarkan pilihan yang sama persis, dan
 * dua salinan kalimat yang menjelaskan satu aturan adalah dua salinan yang cepat
 * atau lambat berbeda -- yang tertinggal biasanya halaman yang lebih jarang
 * disentuh. Pelajaran yang sama sudah dibayar di HintVariabelBroadcast.
 *
 * SELURUHNYA HTML biasa, tanpa satu baris JavaScript klien: radio dan checkbox
 * yang menunjuk form filter lewat atribut `form=`, lalu satu tombol kirim GET.
 * Itu bukan penghematan melainkan syarat -- kedua halaman ini Server Component
 * yang membaca searchParams, jadi keadaan pilihan HARUS hidup di URL supaya
 * tombol maju/mundur peramban, muat ulang, dan tautan yang dibagikan semuanya
 * menghasilkan penerima yang sama.
 */

/** Nilai yang tidak boleh ikut saat "Kosongkan pilihan" -- keduanya justru yang sedang dibuang. */
const DIBUANG_SAAT_KOSONG = ['rm', 'mode'] as const;

export function PenerimaBar({
  formId,
  basePath,
  params,
  mode,
  /**
   * Jumlah yang cocok dengan filter saat ini. NULL pada mode `pilih`, dan itu
   * bukan kelalaian: di sana query segmen memang tidak dijalankan, jadi
   * angkanya tidak diketahui. Mengarangnya (0, atau jumlah yang dicentang)
   * membuat staf memilih berdasarkan angka yang tidak pernah dihitung.
   */
  jumlahCocok,
  /** Jumlah no. RM yang dicentang, dari query string. */
  dicentang,
  /**
   * Jumlah yang benar-benar ketemu di Khanza saat mode `pilih` -- null di mode
   * `semua` (tidak ada yang dicari). Ditampilkan HANYA saat berbeda dari yang
   * dicentang, karena selisihnya berarti ada no. RM yang tidak bisa dikirimi
   * dan itu satu-satunya tempat keadaan itu bisa terlihat.
   */
  ditemukan,
  terpotong,
}: {
  formId: string;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  mode: ModePenerima;
  jumlahCocok: number | null;
  dicentang: number;
  ditemukan: number | null;
  terpotong: boolean;
}) {
  const pilih = mode === 'pilih';

  return (
    <div className="mb-3 rounded-md border bg-card p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Penerima</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" form={formId} name="mode" value="semua" defaultChecked={!pilih} className="accent-primary" />
          Semua yang cocok dengan filter
          {jumlahCocok !== null && <span className="text-muted-foreground">({jumlahCocok})</span>}
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" form={formId} name="mode" value="pilih" defaultChecked={pilih} className="accent-primary" />
          Hanya yang dicentang <span className="text-muted-foreground">({dicentang})</span>
        </label>

        <Button type="submit" form={formId} variant="secondary" size="xs">
          Terapkan
        </Button>
        {dicentang > 0 && (
          <Link
            href={hrefTanpa(basePath, params, DIBUANG_SAAT_KOSONG)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Kosongkan centang
          </Link>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {pilih
          ? 'Tabel di bawah adalah daftar penerimanya. Hilangkan centang lalu Terapkan untuk membuang seseorang, atau kembali ke "Semua yang cocok" untuk mencari pasien lain.'
          : 'Centang di kolom kiri tabel lalu tekan Terapkan. Centang tetap tersimpan saat filter diganti, jadi pasien bisa dikumpulkan lewat beberapa kali pencarian sebelum mode "Hanya yang dicentang" dinyalakan.'}
      </p>

      {/* Selisih ini gagal DIAM kalau tidak dikatakan: yang terlihat cuma angka
          penerima yang lebih kecil daripada yang dicentang, dan tidak ada satu
          pun tempat lain yang menjelaskannya. */}
      {ditemukan !== null && ditemukan !== dicentang && (
        <p className="mt-2 text-xs text-warning">
          {dicentang} dicentang, tapi {ditemukan} yang ketemu di Khanza — sisanya tidak punya riwayat kunjungan (atau no. RM-nya
          sudah tidak ada) sehingga tidak bisa dikirimi.
        </p>
      )}

      {terpotong && (
        <p className="mt-2 text-xs text-warning">
          Centang dipotong di {MAX_PILIHAN_PASIEN} pasien pertama. Untuk kiriman sebanyak itu, pakai filter alih-alih mencentang
          satu per satu.
        </p>
      )}
    </div>
  );
}

/** Header kolom centang -- dipisah supaya lebar/kelasnya tidak menyimpang dari selnya. */
export function KolomPilihHeader() {
  return <th className={`${cellClass} w-8`}>Pilih</th>;
}

export function SelPilih({
  formId,
  noRkmMedis,
  nama,
  terpilih,
}: {
  formId: string;
  noRkmMedis: string;
  nama: string | null;
  terpilih: boolean;
}) {
  return (
    <td className={cellClass}>
      <input
        type="checkbox"
        form={formId}
        name="rm"
        value={noRkmMedis}
        defaultChecked={terpilih}
        // Kotak centang tanpa nama hanya terbaca sebagai "centang, centang,
        // centang" oleh pembaca layar -- pada tabel yang tiap barisnya seorang
        // pasien, itu membuat kolom ini tidak bisa dipakai sama sekali.
        aria-label={`Pilih ${nama ?? noRkmMedis}`}
        className="accent-primary"
      />
    </td>
  );
}

/**
 * No. RM yang dicentang tapi TIDAK sedang tampil di tabel dititipkan sebagai
 * input tersembunyi, supaya centangnya bertahan saat staf mengganti filter atau
 * mencari nama lain.
 *
 * Aturan pengecualiannya sendiri tinggal di core berikut ujinya -- ia
 * satu-satunya bagian fitur ini yang gagal DIAM, dan komponen yang cuma
 * merender tidak bisa dijadikan tempat menjaganya.
 */
export function PilihanTersembunyi({ daftar, tampil }: { daftar: string[]; tampil: Set<string> }) {
  return (
    <>
      {pilihanTersembunyi(daftar, tampil).map((rm) => (
        <input key={rm} type="hidden" name="rm" value={rm} />
      ))}
    </>
  );
}
