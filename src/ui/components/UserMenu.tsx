import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="user-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Button ref={trigger} className="user-menu-trigger" aria-label="User menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
        root.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
      }
    }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3" /><path d="M5 20v-2a7 7 0 0 1 14 0v2" /></svg></Button>
    {open && <div className="user-menu-popup" id={id} role="menu" aria-label="User menu" onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
    }}><ThemeSwitch role="menuitemcheckbox" /></div>}
  </div>;
}
