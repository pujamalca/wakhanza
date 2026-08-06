import { Input, Button } from '@/components/ui';

/**
 * Penyaring rentang tanggal, sebagai FORM GET biasa.
 *
 * Server Component tanpa satu baris pun JavaScript klien: nilainya masuk ke
 * query string, halamannya dirender ulang di server. Sekalian gratis tiga hal
 * yang versi klien harus bangun sendiri -- bisa dibagikan sebagai tautan,
 * tombol maju/mundur peramban bekerja, dan tidak ada state yang bisa
 * berbeda dari yang sedang ditampilkan.
 *
 * `tab` ikut sebagai input tersembunyi. Tanpa itu, menekan Terapkan dari tab
 * Surat sehat akan melemparkan staf kembali ke tab bawaan (Surat sakit)
 * berikut hasil pencarian yang bukan miliknya -- dan yang terlihat cuma daftar
 * yang tiba-tiba berubah isi, tanpa satu pun galat. Bentuk kegagalan yang sama
 * dengan chip status yang membuang `q` di halaman Antrean.
 */
export function RentangTanggal({
  tab,
  dari,
  sampai,
  jumlah,
}: {
  tab: 'sakit' | 'sehat';
  dari: string;
  sampai: string;
  jumlah: number;
}) {
  return (
    <form method="GET" action="/administrasi" className="mb-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value={tab} />
      <div>
        <label htmlFor="dari" className="mb-1 block text-xs text-muted-foreground">
          Dari tanggal
        </label>
        <Input id="dari" name="dari" type="date" defaultValue={dari} fieldSize="sm" />
      </div>
      <div>
        <label htmlFor="sampai" className="mb-1 block text-xs text-muted-foreground">
          Sampai tanggal
        </label>
        <Input id="sampai" name="sampai" type="date" defaultValue={sampai} fieldSize="sm" />
      </div>
      <Button type="submit" variant="secondary" size="sm">
        Terapkan
      </Button>
      <p className="ml-auto text-xs text-muted-foreground">
        {jumlah} {tab === 'sakit' ? 'surat' : 'kunjungan'} ditemukan
      </p>
    </form>
  );
}
