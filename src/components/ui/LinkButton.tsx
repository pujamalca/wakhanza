import Link from 'next/link';
import type { ComponentProps } from 'react';
import { buttonClassName, type ButtonVariant, type ButtonSize } from './Button';

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function LinkButton({ variant = 'secondary', size = 'sm', className = '', ...props }: LinkButtonProps) {
  return <Link className={buttonClassName(variant, size, className)} {...props} />;
}
