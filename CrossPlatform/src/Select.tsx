import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-select';
import { useViewActive } from './RetainedView';

type OptionProps = { value?: string | number; children: ReactNode; disabled?: boolean };
// Declarative options are consumed by Select, never rendered as native selects.
export function SelectOption(_props: OptionProps) { return null; }

export function Select({value,onValueChange,children,disabled,placeholder,variant='default',...label}:{
  value:string|number|null;onValueChange:(value:string)=>void;children:ReactNode;
  disabled?:boolean;placeholder?:string;variant?:'default'|'transcription'|'inline';'aria-label'?:string;
}) {
  const active = useViewActive(), [open, setOpen] = useState(false);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  // Prefix every value: Radix reserves an empty string for the placeholder,
  // while No Type uses it for the system microphone and default speech model.
  const encode=(value:string|number)=>`option:${value}`;
  return <Primitive.Root open={open && active} onOpenChange={setOpen} value={value===null?'':encode(value)} onValueChange={next=>onValueChange(next.slice(7))} disabled={disabled}>
    <Primitive.Trigger className={'select-trigger'+(variant==='default'?'':' select-transcription')+(variant==='inline'?' select-inline':'')} {...label}>
      <Primitive.Value placeholder={placeholder}/>
      <Primitive.Icon className="select-chevron"><img src="/assets/settings/chevron-down.svg" width="16" height="16" alt=""/></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Content className={'select-menu'+(variant==='default'?'':' select-transcription-menu')} position="item-aligned" onEscapeKeyDown={event=>event.stopPropagation()}>
        <Primitive.ScrollUpButton className="select-scroll">⌃</Primitive.ScrollUpButton>
        <Primitive.Viewport className="select-viewport">
          {Children.toArray(children).map(child=>{
            if(!isValidElement<OptionProps>(child))return null;
            const option=child.props,key=encode(option.value??String(option.children));
            return <Primitive.Item key={key} value={key} className="select-item" disabled={option.disabled}>
              <Primitive.ItemText>{option.children}</Primitive.ItemText>
              <Primitive.ItemIndicator className="select-check"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></Primitive.ItemIndicator>
            </Primitive.Item>;
          })}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="select-scroll">⌄</Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
