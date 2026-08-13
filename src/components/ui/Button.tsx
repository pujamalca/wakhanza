import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border hover:bg-muted',
  destructive: 'border border-destructive text-destructive hover:bg-destructive/10',
  ghost: 'hover:bg-muted',
};

/**
 * Tinggi DIPAKU, tidak lagi lahir dari padding + ukuran font.
 *
 * Sebelumnya tombol, kotak isian, dan dropdown yang berdiri bersebelahan di satu
 * baris saringan berakhir dengan tiga tinggi yang berbeda beberapa piksel --
 * cukup untuk terbaca sebagai "tidak rapi", tidak cukup untuk siapa pun bisa
 * menunjuk sebabnya. Sekarang `md` = 36px di ketiganya.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-caption',
  sm: 'h-8 px-3 text-label',
  md: 'h-9 px-4 text-body',
};

// Dipakai bersama oleh Button (<button>) dan LinkButton (<Link>) supaya
// keduanya selalu identik secara visual tanpa duplikasi daftar class.
export function buttonClassName(variant: ButtonVariant = 'secondary', size: ButtonSize = 'sm', className = ''): string {
  return `inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'sm', className = '', type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={buttonClassName(variant, size, className)} {...props} />
  ),
);
Button.displayName = 'Button';
