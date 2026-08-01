import { LinkButton } from './LinkButton';
import { IconChevronLeft, IconChevronRight } from './icons';

/**
 * Sebelumnya tiap halaman menulis sendiri dua `<a>` bergaris bawah dengan
 * perakitan query string masing-masing -- gampang tidak sinkron dan tidak
 * terlihat sebagai kontrol yang bisa diklik. `hrefFor` menerima nomor halaman
 * dan mengembalikan URL lengkap, jadi tiap halaman tetap memegang parameter
 * filternya sendiri tanpa komponen ini perlu tahu apa saja parameternya.
 */
export function Pagination({
  page,
  totalPages,
  count,
  hrefFor,
  unit = 'baris',
}: {
  page: number;
  totalPages: number;
  count: number;
  hrefFor: (page: number) => string;
  unit?: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Halaman <span className="font-medium text-foreground">{page}</span> dari {totalPages} ·{' '}
        {new Intl.NumberFormat('id-ID').format(count)} {unit}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <LinkButton href={hrefFor(page - 1)} variant="secondary">
            <IconChevronLeft className="h-4 w-4" />
            Sebelumnya
          </LinkButton>
        ) : (
          // Dinonaktifkan sebagai <span>, bukan disembunyikan: tombol yang hilang
          // dan muncul kembali membuat baris ini bergeser tiap ganti halaman.
          <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium opacity-50">
            <IconChevronLeft className="h-4 w-4" />
            Sebelumnya
          </span>
        )}
        {page < totalPages ? (
          <LinkButton href={hrefFor(page + 1)} variant="secondary">
            Berikutnya
            <IconChevronRight className="h-4 w-4" />
          </LinkButton>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium opacity-50">
            Berikutnya
            <IconChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  );
}
