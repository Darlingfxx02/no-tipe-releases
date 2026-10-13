import { useEffect, useRef } from 'react';

export function RecorderChoices({label,value,options,onSelect}:{label:string;value:string;options:readonly (readonly [string,string,string?])[];onSelect:(value:string)=>void}) {
  const group=useRef<HTMLDivElement>(null);
  useEffect(()=>{group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();},[]);
  return <div ref={group} className="notch-choice-list" role="radiogroup" aria-label={label} onKeyDown={event=>{
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];const index=items.indexOf(event.target as HTMLButtonElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+items.length)%items.length;
    items[next]?.focus();
  }}>{options.map(([id,name,color])=><button className="notch-setting" role="radio" aria-checked={value===id} tabIndex={value===id?0:-1} key={id} onClick={()=>onSelect(id)}><span className="notch-choice-name">{color&&<i className="empowerment-dot" style={{background:color}} aria-hidden="true"/>}{name}</span><span aria-hidden="true">{value===id?'✓':''}</span></button>)}</div>;
}
