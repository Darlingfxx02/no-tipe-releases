import { useRef, type ButtonHTMLAttributes } from 'react';
import './design-controls.css';

// Figma NoType/Button (272:943): native button semantics and shared theme tokens.
export function NoTypeButton({ variant = 'secondary', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return <button {...props} type={type} className={`notype-button notype-button-${variant} ${className}`}/>;
}

// Figma NoType/Tab (272:1008), including its documented keyboard behavior.
export function NoTypeTabs<T extends string>({ id, label, items, value, onChange, variant='tabs' }:{
  id:string; label:string; items:readonly {value:T; label:string; minWidth?:number}[]; value:T; onChange:(value:T)=>void; variant?:'tabs'|'segmented';
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <nav className={`notype-tabs${variant==='segmented'?' notype-segmented-control':''}`} role="tablist" aria-label={label}>
    {items.map((item, index) => <button key={item.value} ref={button => {buttons.current[index] = button;}}
      type="button" role="tab" style={{minWidth:variant==='tabs'?item.minWidth:undefined}} id={`${id}-tab-${item.value}`} aria-controls={`${id}-panel-${item.value}`}
      aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1}
      onClick={() => onChange(item.value)} onKeyDown={event => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault();
        onChange(items[next].value);
        buttons.current[next]?.focus();
      }}>{item.label}</button>)}
  </nav>;
}
