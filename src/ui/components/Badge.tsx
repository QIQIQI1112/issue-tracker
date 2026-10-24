import type { ComponentProps } from 'react';

export function Badge({ className = 'status-pill', ...props }: ComponentProps<'span'>) {
  return <span className={className} {...props} />;
}
