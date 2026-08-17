import { Input, Button, LinkButton } from '@/components/ui';
import type { StatusEntry } from '@/models';

/**
 * Penyaring rentang tanggal untuk tab Masuk, sebagai FORM GET biasa.
 *
 * Server Component tanpa satu baris pun JavaScript klien: nilainya masuk ke
 * query string, halamannya dirender ulang di server. Sekalian gratis tiga hal
 * yang versi klien harus bangun sendiri -- bisa dibagikan sebagai tautan,
 * tombol maju/mundur peramban bekerja, dan tidak ada state yang bisa berbeda
 * dari yang sedang ditampilkan. Bentuk yang sama dipakai `/administrasi`.
 *
 * ==========================================================================
 * `tab` DAN `status` ikut sebagai input tersembunyi
 * ==========================================================================
 *
 * Tanpa `tab`, menekan Terapkan melemparkan staf kembali ke tab bawaan.
 * Tanpa `status`, ia diam-diam melompat dari "Baru" ke "Semua" -- dan yang
 * terlihat cuma daftar yang tiba-tiba berisi permintaan yang sudah selesai,
 * tanpa satu pun galat. Bentuk kegagalan yang sama dengan chip status yang
 * membuang `q` di halaman Antrean.
 *
 * ==========================================================================
 * Kenapa ada tombol "Semua tanggal" terpisah
 * ==========================================================================
 *
 * Mengosongkan kedua kotak tanggal lalu menekan Terapkan adalah cara yang
 * TIDAK bekerja di `<input type="date">`: sebagian peramban menolak mengirim
 * nilai kosong dari kotak yang pernah terisi, dan staf berakhir terkunci di
 * rentang yang tidak bisa dilepasnya. Tautan yang membuang kedua parameter
 * selalu bekerja, di peramban mana pun.
 */
export function RentangTanggal({
  status,
  dari,
  sampai,
  jumlah,
  aktif,
}: {
  status: StatusEntry | null;
  dari: string;
  sampai: string;
  jumlah: number;
  /** true bila rentangnya sedang benar-benar menyaring. */
  aktif: boolean;
}) {
  const hrefSemua = status ? `/formulir?tab=masuk&status=${status}` : '/formulir?tab=masuk';

  return (
    <form method="GET" action="/formulir" className="mb-3 flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="masuk" />
      {status && <input type="hidden" name="status" value={status} />}
      <div>
        <label htmlFor="dari" className="mb-1 block text-caption text-muted-foreground">
          Dari tanggal
        </label>
        <Input id="dari" name="dari" type="date" defaultValue={dari} fieldSize="sm" />
      </div>
      <div>
        <label htmlFor="sampai" className="mb-1 block text-caption text-muted-foreground">
          Sampai tanggal
        </label>
        <Input id="sampai" name="sampai" type="date" defaultValue={sampai} fieldSize="sm" />
      </div>
      <Button type="submit" variant="secondary" size="sm">
        Terapkan
      </Button>
      {aktif && (
        <LinkButton href={hrefSemua} variant="ghost" size="sm">
          Semua tanggal
        </LinkButton>
      )}
      <p className="ml-auto text-caption text-muted-foreground">
        {aktif ? `${jumlah} jawaban pada rentang ini` : `${jumlah} jawaban seluruhnya`}
      </p>
    </form>
  );
}
