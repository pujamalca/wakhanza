/**
 * Kepala halaman: judul, satu kalimat keterangan, kontrol tingkat halaman, dan
 * pintu bantuan.
 *
 * Judulnya memakai `text-display` (28px/600) alih-alih `text-xl font-semibold`
 * yang dipakai sebelumnya. Bedanya bukan selera: dengan badan teks 12-14px yang
 * mendominasi halaman, judul 20px terlalu dekat dengan isinya untuk berfungsi
 * sebagai jangkar -- diukur, 97% teks di dashboard ini hidup di dua ukuran yang
 * hanya berjarak 2px. Tangga yang terlalu rapat sama saja dengan tidak ada
 * tangga.
 *
 * `description` sengaja SATU kalimat dan dibatasi `measure`. Keterangan panjang
 * tempatnya di `HelpPanel` lewat slot `help` -- kepala halaman yang berisi tiga
 * paragraf mendorong kontrol pertama ke bawah lipatan layar, dan yang paling
 * sering dipakai jadi yang paling jauh dijangkau.
 */
export function PageHeader({
  title,
  description,
  actions,
  help,
}: {
  title: string;
  /** Satu kalimat. Lebih dari itu tempatnya di `help`. */
  description?: React.ReactNode;
  /** Tombol/kontrol tingkat halaman. Slot terpisah supaya posisinya sama di semua halaman. */
  actions?: React.ReactNode;
  /**
   * `<HelpPanel>`. Dipisah dari `actions` supaya ia selalu mendarat di ujung
   * kanan, di tempat yang sama di setiap halaman -- bantuan yang posisinya
   * berpindah-pindah adalah bantuan yang dicari dulu sebelum dipakai.
   */
  help?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-4">
      <div className="min-w-0">
        <h1 className="text-display">{title}</h1>
        {description && (
          <p className="measure mt-1.5 text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {(actions || help) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {help}
        </div>
      )}
    </div>
  );
}
