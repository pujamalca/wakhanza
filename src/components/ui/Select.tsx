import { forwardRef, type SelectHTMLAttributes } from 'react';

type FieldSize = 'sm' | 'md';

const SIZE_CLASSES: Record<FieldSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
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
