import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

type Option = { value: string; label: ReactNode; group?: string; disabled: boolean };
type NativeOption = { value?: string; children?: ReactNode; label?: string; disabled?: boolean };
type Props = { value: string; onChange: (value: string) => void; children?: ReactNode; 'aria-label': string; disabled?: boolean };

function readOptions(children: ReactNode, group?: string, disabled = false): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<NativeOption>(child)) return [];
    if (child.type === 'optgroup') return readOptions(child.props.children, child.props.label, disabled || Boolean(child.props.disabled));
    if (child.type !== 'option') return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, group, disabled: disabled || Boolean(child.props.disabled) }];
  });
}

export function Dropdown({ value, onChange, children, 'aria-label': name, disabled = false }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [placement, setPlacement] = useState<CSSProperties>({});
  const options = readOptions(children);
  const selected = options.find(option => option.value === value);
  const enabled = options.filter(option => !option.disabled);
  const active = enabled.find(option => option.value === activeValue) ?? enabled.find(option => option.value === value) ?? enabled[0];
  const activeIndex = options.findIndex(option => option === active);
  const expanded = open && !disabled;
  const optionId = (index: number) => `${id}-option-${index}`;

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const width = Math.max(1, Math.min(Math.max(rect.width, 240), rightEdge - leftEdge));
      const below = Math.max(0, bottomEdge - rect.bottom - 4);
      const above = Math.max(0, rect.top - topEdge - 4);
      const upwards = below < 180 && above > below;
      const maxHeight = Math.max(1, Math.min(320, bottomEdge - topEdge, upwards ? above : below));
      setPlacement({ width, maxWidth: Math.max(1, rightEdge - leftEdge), maxHeight, left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)), ...(upwards ? { bottom: window.innerHeight - Math.min(bottomEdge, rect.top - 4) } : { top: Math.max(topEdge, Math.min(rect.bottom + 4, bottomEdge - maxHeight)) }) });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [expanded]);

  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [expanded, activeIndex, id]);

  const show = () => { setActiveValue(selected && !selected.disabled ? selected.value : enabled[0]?.value ?? null); setOpen(true); };
  const commit = (option: Option | undefined) => {
    if (!option || option.disabled) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    onChange(option.value);
  };
  const row = (option: Option, index: number) => <div key={option.value} id={optionId(index)} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={option === active} className="dropdown-option" onMouseDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }} onClick={() => commit(option)}>{option.label}</div>;
  const groups: { label?: string; rows: ReactNode[] }[] = [];
  options.forEach((option, index) => {
    if (!groups.length || groups[groups.length - 1].label !== option.group) groups.push({ label: option.group, rows: [] });
    groups[groups.length - 1].rows.push(row(option, index));
  });

  return <div className="dropdown" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <select className="dropdown-backing" hidden aria-hidden={true} tabIndex={-1} aria-label={name} value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}>{children}</select>
    <button ref={trigger} type="button" className="dropdown-trigger" role="combobox" aria-label={name} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={`${id}-listbox`} aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined} disabled={disabled} onClick={() => { if (expanded) setOpen(false); else show(); }} onKeyDown={event => {
      if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
      if (event.key === 'Tab') { setOpen(false); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (expanded) commit(active); else show(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!expanded) { show(); if (event.key === 'Home' || event.key === 'End') setActiveValue((event.key === 'Home' ? enabled[0] : enabled.at(-1))?.value ?? null); return; }
      const index = enabled.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(enabled[next]?.value ?? null);
    }}><span className="dropdown-value">{selected?.label ?? (value || 'No options')}</span><Icon name="chevron" className="dropdown-chevron" /></button>
    {expanded && <div id={`${id}-listbox`} role="listbox" aria-label={name} className="dropdown-panel" style={placement}>{groups.map((group, index) => group.label ? <div key={index} role="group" aria-label={group.label}><div className="dropdown-group-label" aria-hidden="true">{group.label}</div>{group.rows}</div> : group.rows)}{!options.length && <div className="dropdown-empty">No options available</div>}</div>}
  </div>;
}
