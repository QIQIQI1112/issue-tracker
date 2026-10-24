import { useState } from 'react';
import { Button } from './Button.tsx';
import { currentTheme, selectTheme } from '../theme/preference.ts';

export function ThemeSwitch({ role = 'switch', presentation = 'switch' }: { role?: 'switch' | 'menuitemcheckbox'; presentation?: 'switch' | 'menu' }) {
  const [theme, setTheme] = useState(currentTheme);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    selectTheme(next);
    setTheme(next);
  }
  return <Button className={presentation === 'menu' ? 'theme-menu-row' : 'button theme-switch'} role={role} aria-label="Dark mode" aria-checked={theme === 'dark'} onClick={toggle}>
    {presentation === 'menu' ? <>
      <svg className="theme-menu-moon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>
      <span className="theme-menu-label">Dark mode</span>
      {theme === 'dark' && <svg className="theme-menu-check" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
    </> : <><span>Dark mode</span><span className="theme-switch-track" aria-hidden="true"><span /></span><span className="theme-switch-state" aria-hidden="true">{theme === 'dark' ? 'On' : 'Off'}</span></>}
  </Button>;
}
