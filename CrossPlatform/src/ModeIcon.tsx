import { t, useLocale } from './i18n';
import { useRef } from 'react';
import { Icon } from './ui';
import { getModeIcons, resolveModeIcon } from './modeIcons';

export function ModeIcon({value,size=24}:{value:string;size?:number}) {
  const icon=resolveModeIcon(value);
  return <Icon name={icon.asset} src={`/assets/mode-icons/${icon.asset}.svg`} size={size}/>;
}

export function ModeIconPicker({value,onChange}:{value:string;onChange:(icon:string)=>void}) {
  useLocale();
  const selected=resolveModeIcon(value);
  const buttons=useRef<(HTMLButtonElement|null)[]>([]);
  return <div className="mode-icon-picker">
    <span className="mode-icon-label">{t('ModeIcon.icon')}</span>
    <div className="mode-icon-options" role="radiogroup" aria-label={t('ModeIcon.mode_icon')}>
      {getModeIcons().map((icon,index)=><button key={icon.id} type="button" role="radio" aria-label={icon.label} title={icon.label} aria-checked={selected.id===icon.id} tabIndex={selected.id===icon.id?0:-1} className={`mode-icon-option ${selected.id===icon.id?'selected':''}`} ref={element=>{buttons.current[index]=element;}} onClick={()=>onChange(icon.id)} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?getModeIcons().length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+getModeIcons().length)%getModeIcons().length;
        onChange(getModeIcons()[next].id);buttons.current[next]?.focus();
      }}><ModeIcon value={icon.id}/></button>)}
    </div>
    <span className="mode-icon-caption muted">{selected.label}</span>
  </div>;
}
