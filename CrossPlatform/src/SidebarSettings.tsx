import {useEffect, useRef, useState, type CSSProperties} from 'react';
import type {Props} from './pages';
import {t, useLocale} from './i18n';
import {Icon, SettingsGroup, Switch} from './ui';
import {NoTypeButton} from './DesignControls';
import {orderedSidebar, pageLabels, type SidebarPage} from './navigation';

type Drag={page:SidebarPage;from:number;to:number;offset:number;startY:number;listTop:number;tops:number[];height:number;settling:boolean};
export function SidebarSettings({data,save,run}:Pick<Props,'data'|'save'|'run'>) {
  useLocale();
  const routes=orderedSidebar(data.preferences), hidden=data.preferences.sidebarHidden ?? [];
  const list=useRef<HTMLUListElement>(null), timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [drag,setDrag]=useState<Drag|null>(null), dragging=useRef<Drag|null>(null);
  const [announcement,setAnnouncement]=useState('');
  const updateDrag=(next:Drag|null)=>{dragging.current=next;setDrag(next);};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const move=(page:SidebarPage,to:number)=>{
    const order=routes.map(([name])=>name), from=order.indexOf(page);
    if(to<0||to>=order.length||to===from)return;
    order.splice(from,1);order.splice(to,0,page);
    void run(async()=>{await save({sidebarOrder:order});setAnnouncement(t('Settings.menu_moved',{name:t(pageLabels[page]),position:to+1,total:order.length}));});
  };
  const finish=(cancel=false)=>{
    const current=dragging.current;if(!current||current.settling)return;
    const to=cancel?current.from:current.to;
    updateDrag({...current,to,offset:current.tops[to]-current.tops[current.from],settling:true});
    const complete=()=>{if(!cancel)move(current.page,to);updateDrag(null);};
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)complete();
    else timer.current=setTimeout(complete,180);
  };
  return <SettingsGroup title={t('Settings.sidebar_menu')} help={t('Settings.sidebar_menu_help')} titleIcon={<Icon name="dashboard"/>}>
    <ul ref={list} className="sidebar-settings-list" data-reordering={!!drag}>
      {routes.map(([page,icon],index)=>{
        const shifted=drag&&(drag.from<drag.to&&index>drag.from&&index<=drag.to?-drag.height:drag.from>drag.to&&index>=drag.to&&index<drag.from?drag.height:0);
        const offset=drag?.page===page?drag.offset:shifted||0;
        return <li key={page} data-sidebar-page={page} data-dragging={drag?.page===page} data-settling={drag?.settling} style={{transform:`translateY(${offset}px)`} as CSSProperties}>
          <NoTypeButton className="sidebar-drag-handle" aria-label={t('Settings.move_menu_item',{name:t(pageLabels[page])})}
            onPointerDown={event=>{
              if(event.button!==0||dragging.current)return;
              event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
              const bounds=[...list.current!.children].map(row=>row.getBoundingClientRect()), listTop=list.current!.getBoundingClientRect().top;
              updateDrag({page,from:index,to:index,offset:0,startY:event.clientY,listTop,tops:bounds.map(r=>r.top-listTop),height:bounds[index].height,settling:false});
            }}
            onPointerMove={event=>{
              const current=dragging.current;if(!current||current.settling)return;
              const viewport=list.current!.closest<HTMLElement>('.scroll-area-viewport');
              if(viewport){const r=viewport.getBoundingClientRect();if(event.clientY<r.top+40)viewport.scrollTop-=12;else if(event.clientY>r.bottom-40)viewport.scrollTop+=12;}
              const offset=event.clientY-current.startY+current.listTop-list.current!.getBoundingClientRect().top;
              const center=current.tops[current.from]+current.height/2+offset;
              let to=0;for(let i=1;i<current.tops.length;i++)if(center>current.tops[i])to=i;
              updateDrag({...current,to,offset});
            }}
            onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>{if(!dragging.current?.settling)finish(true);}}
            onKeyDown={event=>{if(event.key==='Escape'){finish(true);return;}if(!dragging.current&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();move(page,index+(event.key==='ArrowUp'?-1:1));}}}>
            <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">{[5,10,15].map(y=><g key={y}><circle cx="5" cy={y} r="1"/><circle cx="11" cy={y} r="1"/></g>)}</svg>
          </NoTypeButton>
          <Icon name={icon} size={18}/><span className="sidebar-settings-label">{t(pageLabels[page])}</span>
          <Switch label={t('Settings.show_menu_item',{name:t(pageLabels[page])})} disabled={!!drag} value={!hidden.includes(page)} onChange={visible=>void run(()=>save({sidebarHidden:visible?hidden.filter(name=>name!==page):[...hidden,page]}))}/>
        </li>;
      })}
    </ul>
    <span className="sr-only" role="status">{announcement}</span>
  </SettingsGroup>;
}
