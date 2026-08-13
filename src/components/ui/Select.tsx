import { forwardRef, type SelectHTMLAttributes } from 'react';

type FieldSize = 'sm' | 'md';

// Tinggi disamakan dengan Input dan Button ukuran sepadan (h-9 = 36px), supaya
// sebuah baris saringan yang memuat ketiganya rata di bawah -- sebelumnya
// tingginya lahir dari padding + ukuran font, jadi tiga kontrol bersebelahan
// berakhir tiga tinggi yang berbeda beberapa piksel. Selisih kecil itu justru
// yang terbaca sebagai "tidak rapi" tanpa bisa ditunjuk sebabnya.
// `text-base` di layar kecil: alasan yang sama dengan Input (Safari iOS
// memperbesar halaman pada kotak isian di bawah 16px).
const SIZE_CLASSES: Record<FieldSize, string> = {
  sm: 'px-2 py-1 text-body sm:text-caption',
  md: 'h-9 px-3 py-1.5 text-base sm:text-body',
};

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fieldSize?: FieldSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ fieldSize = 'md', className = '', ...props }, ref) => (
    <select
      ref={ref}
      className={`rounded-md border bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[fieldSize]} ${className}`}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
