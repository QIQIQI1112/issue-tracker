import type { ReactNode } from 'react';

type ToolbarIconName = 'issues' | 'database' | 'check' | 'arrow' | 'chevrons';
const glyphs: Record<ToolbarIconName, ReactNode> = {
  issues: <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  arrow: <path d="M5 12h14m-7-7 7 7-7 7" />,
  chevrons: <path d="m11 17-5-5 5-5m7 10-5-5 5-5" />,
};

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return <span className="toolbar-icon-slot" aria-hidden="true"><svg focusable="false" viewBox="0 0 24 24" className="icon toolbar-icon" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{glyphs[name]}</svg></span>;
}
