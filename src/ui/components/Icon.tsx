import type { CSSProperties } from 'react';

type IconName = 'issues' | 'plus' | 'search' | 'chevron' | 'chevronDown' | 'close' | 'trash' | 'database' | 'check' | 'pencil' | 'arrow';
const paths: Record<IconName, string> = {
  issues: 'M8 5h12M8 12h12M8 19h12M3 5h.01M3 12h.01M3 19h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  chevron: 'M9 5l7 7-7 7',
  chevronDown: 'm6 9 6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  database: 'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3',
  check: 'M20 6 9 17l-5-5',
  pencil: 'm16 3 5 5-13 13H3v-5L16 3ZM13 6l5 5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={`icon ${className ?? ''}`} style={style} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
