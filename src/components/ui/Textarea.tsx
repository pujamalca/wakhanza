import { forwardRef, type TextareaHTMLAttributes } from 'react';

type FieldSize = 'sm' | 'md';

const SIZE_CLASSES: Record<FieldSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
};

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  fieldSize?: FieldSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ fieldSize = 'md', className = '', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[fieldSize]} ${className}`}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
