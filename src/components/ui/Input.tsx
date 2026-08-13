import { forwardRef, type InputHTMLAttributes } from 'react';

type FieldSize = 'sm' | 'md';

/**
 * `text-base sm:text-body` pada ukuran `md`, dan itu BUKAN kelebihan hati-hati.
 *
 * Safari iOS memperbesar halaman sendiri begitu sebuah kotak isian yang di-fokus
 * berukuran di bawah 16px, lalu tidak mengembalikannya. Di tablet loket, tiap
 * kali petugas menyentuh kotak pencarian seluruh halaman melompat dan mereka
 * harus mencubit untuk kembali -- gejala yang terbaca sebagai "aplikasinya
 * rusak", bukan sebagai setelan tipografi.
 *
 * Jadi 16px di layar kecil (tempat masalahnya ada), 14px sejak `sm` ke atas
 * (tempat kerapatannya berguna dan tidak ada peramban yang memperbesar).
 */
const SIZE_CLASSES: Record<FieldSize, string> = {
  sm: 'px-2 py-1 text-body sm:text-caption',
  md: 'h-9 px-3 py-1.5 text-base sm:text-body',
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  fieldSize?: FieldSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ fieldSize = 'md', className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[fieldSize]} ${className}`}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
