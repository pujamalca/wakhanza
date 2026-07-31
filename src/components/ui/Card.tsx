import type { HTMLAttributes } from 'react';

export const cardClassName = 'rounded-lg border bg-card p-4 shadow-sm';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${cardClassName} ${className}`} {...props} />;
}
