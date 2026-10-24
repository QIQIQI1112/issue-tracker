import type { ComponentProps } from 'react';

export function Button({ type = 'button', className = 'button', loading = false, disabled, ...props }: ComponentProps<'button'> & { loading?: boolean }) {
  return <button type={type} className={className} disabled={disabled || loading} aria-busy={loading || undefined} {...props} />;
}
