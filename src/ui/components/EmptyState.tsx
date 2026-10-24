import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function EmptyState({ title, children, icon, loading = false, role }: { title: string; children?: ReactNode; icon?: 'issues' | 'database'; loading?: boolean; role?: 'status' }) {
  return <div className="state-panel" role={role}>{loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}<h2>{title}</h2>{children}</div>;
}
