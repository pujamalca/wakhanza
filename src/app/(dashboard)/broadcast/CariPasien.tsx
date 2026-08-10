import Link from 'next/link';
import { hrefTanpa } from '@/core/hrefFilter';
import { Button, Input } from '@/components/ui';

/**
 * Kotak cari pasien, DIPASANG TEPAT DI ATAS TABELNYA -- dipakai bersama
 * /broadcast dan /broadcast-terjadwal.
 *
 * ==========================================================================
 * Kenapa dipindah ke sini, dan kenapa itu bukan soal selera
 * ==========================================================================
 *
 * Sebelumnya kotak ini duduk di tengah form filter, di antara rentang tanggal
 * dan dua daftar centang wilayah. Yang memisahkannya dari tabel: dua kolom
 * daftar wilayah, daftar cara bayar, tombol Terapkan, kotak peringatan
 * cakupan, bilah penerima, dan lima kotak angka -- lebih dari satu layar penuh
 * di monitor loket. Jadi mencari seorang pasien berarti menggulir NAIK melewati
 * semuanya, mengetik, lalu menggulir TURUN lagi untuk melihat hasilnya, tiap
 * kali. Yang dicari orang saat melihat daftar nama adalah kotak cari yang
 * menempel pada daftar itu; kotak yang tidak ada di sana dibaca sebagai kotak
 * yang tidak ada.
 *
 * Letaknya berpindah, PEMILIKNYA tidak: `form={formId}` membuatnya tetap
 * terkirim bersama form filter di atas, jadi tidak ada state klien, tidak ada
 * form kedua, dan seluruh saringan tetap berangkat sekali jalan. Pola yang sama
 * dipakai centang penerima (lihat PilihPenerima.tsx).
 *
 * ==========================================================================
 * Enter di kotak ini DULU MENIMPA rentang tanggal -- lihat TombolSubmitBawaan
 * ==========================================================================
 */

/**
 * Tombol submit TANPA NAMA, wajib jadi anak PERTAMA form filter.
 *
 * Menekan Enter di sebuah kotak teks tidak "mengirim formnya" begitu saja:
 * peramban mengklik **tombol submit pertama dalam urutan dokumen** milik form
 * itu, berikut `name`/`value`-nya. Di kedua halaman broadcast, tombol pertama
 * itu adalah preset tanggal (`name="preset"`), dan `parseFilters` memberi
 * `preset` prioritas di atas `dateFrom`/`dateTo`. Akibatnya: staf menyetel
 * rentang tanggalnya sendiri, mengetik nama pasien, menekan Enter -- dan
 * rentangnya diam-diam kembali ke "1 bulan terakhir". Tidak ada galat, dan
 * gejalanya adalah pasien yang dicari lenyap dari hasil justru karena
 * dicarinya.
 *
 * Diukur, bukan disimpulkan dari spesifikasi: replika struktur kedua halaman
 * dijalankan di Chromium sungguhan.
 *
 *   sebelum : ?dateFrom=2026-01-01&preset=1m&cari=Budi
 *   sesudah : ?dateFrom=2026-01-01&cari=Budi
 *
 * Tombol ini menang sebagai "tombol bawaan" karena ia lebih dulu di urutan
 * dokumen, dan karena ia tanpa `name` ia tidak menitipkan apa pun. Tombol
 * "Terapkan filter" yang terlihat tetap ada di ujung form dan tidak berubah.
 *
 * `sr-only` (bukan `hidden`) DISENGAJA: yang dipakai peramban sebagai tombol
 * bawaan adalah tombol yang benar-benar dirender. Itu bentuk yang diuji di
 * atas, jadi itu yang dipakai. `aria-hidden` + `tabIndex={-1}` menjauhkannya
 * dari pembaca layar dan urutan Tab -- ia bukan kendali yang perlu ditemukan
 * siapa pun, cuma penadah tekanan Enter.
 */
export function TombolSubmitBawaan() {
  return (
    <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
      Terapkan filter
    </button>
  );
}

export function CariPasien({
  formId,
  basePath,
  params,
  nilai,
  /**
   * True saat penerimanya sedang daftar centang. Di sana query segmen memang
   * tidak dijalankan (lihat core/pilihanPasien.ts), jadi mengetik apa pun di
   * sini tidak mengubah satu baris pun -- kotak yang menerima ketikan lalu
   * tidak melakukan apa-apa adalah bentuk kegagalan diam yang paling gampang
   * dibuat di halaman ini.
   */
  nonaktif,
}: {
  formId: string;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  nilai: string;
  nonaktif: boolean;
}) {
  const idKotak = `${formId}-cari`;

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={idKotak} className="text-xs font-medium text-muted-foreground">
          Cari pasien
        </label>
        <Input
          id={idKotak}
          form={formId}
          name="cari"
          defaultValue={nilai}
          // readOnly, BUKAN disabled: kotak yang disabled tidak ikut terkirim,
          // jadi pencarian staf akan lenyap begitu ia menyalakan mode centang
          // lalu kembali. Yang perlu dicegah cuma mengetik ke sesuatu yang
          // tidak berlaku, bukan nilainya bertahan.
          readOnly={nonaktif}
          placeholder="Nama, no. RM, atau no. pendaftaran..."
          className={`w-full sm:w-80 ${nonaktif ? 'opacity-50' : ''}`}
          fieldSize="sm"
        />
        <Button type="submit" form={formId} variant="secondary" size="sm" disabled={nonaktif}>
          Cari
        </Button>
        {nilai && !nonaktif && (
          <Link
            href={hrefTanpa(basePath, params, ['cari'])}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            hapus pencarian
          </Link>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {nonaktif
          ? 'Penerimanya sedang daftar centang, jadi pencarian tidak berlaku — tabel di bawah adalah daftar itu sendiri. Kembali ke "Semua yang cocok dengan filter" untuk mencari lagi.'
          : 'Nama atau no. RM dari tabel pasien, atau no. pendaftaran dari tabel reg_periksa. Kosong = semua yang cocok dengan filter di atas.'}
      </p>
    </div>
  );
}
