import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border hover:bg-muted',
  destructive: 'border border-destructive text-destructive hover:bg-destructive/10',
  ghost: 'hover:bg-muted',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
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
