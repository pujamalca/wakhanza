import { Card, Skeleton, cardClassName } from '@/components/ui';

/**
 * Ringkasan menjalankan enam agregasi sekaligus, jadi jeda muatnya terasa.
 * Rangka ini memakai bentuk yang sama dengan halaman aslinya supaya isinya
 * tidak "melompat" saat data datang.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="mb-6 border-b pb-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      </div>

      <Skeleton className="h-28 w-full rounded-lg" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cardClassName}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className={cardClassName}>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-4 h-44 w-full" />
          </div>
        </div>
        <Card>
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="mt-2 h-1.5 w-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
