import { useState } from 'react';
import { Button } from './Button.tsx';
import { currentTheme, selectTheme } from '../theme/preference.ts';

export function ThemeSwitch() {
  const [theme, setTheme] = useState(currentTheme);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    selectTheme(next);
    setTheme(next);
  }
  return <Button className="button theme-switch" role="switch" aria-label="Dark mode" aria-checked={theme === 'dark'} onClick={toggle}>
    <span>Dark mode</span><span className="theme-switch-track" aria-hidden="true"><span /></span><span className="theme-switch-state" aria-hidden="true">{theme === 'dark' ? 'On' : 'Off'}</span>
  </Button>;
}
