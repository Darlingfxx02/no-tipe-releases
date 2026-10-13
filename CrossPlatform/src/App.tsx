import { t, useLocale, setUiLanguage } from './i18n';
import { ScrollArea } from './ScrollArea';
import { BrandMark } from './BrandMark';
import { UsageConsent } from './UsageConsent';
import { Dashboard } from './Dashboard';
import { DashboardWave } from './DashboardWave';
import { PreferenceWriter } from './preferenceWriter';
import { Settings } from './Settings';
import { shortcutLabel } from './shortcuts';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, native, preview, errorMessage, openUrl, errorSource } from './api';
import { AuthorSupport, AUTHOR_BOOSTY_URL } from './AuthorSupport';
import type { Bootstrap, Page, Preferences, Snapshot, Transcript } from './types';
import { PermissionSetup } from './Permissions';
import { Icon } from './ui';
import { TranscriptDetail } from './TranscriptDetail';
import { TranscriptErrorDialogState } from './TranscriptError';
import { processingBusy } from './transcriptProcessing';
import type { ProcessTranscript, RetryRecognition } from './transcriptProcessing';
import { Customization, RecorderPlacementControl } from './Customization';
import { Dictionary } from './Dictionary';
import { Insights } from './Insights';
import { Transcribe } from './Transcribe';
import { Modes } from './Modes';
import { useTheme } from './theme';
import { CopyFeedback, copyAnchor } from './CopyFeedback';
import type { CopyNotice, CopyWithFeedback } from './CopyFeedback';
import { RetainedView } from './RetainedView';
import { recordDiagnostic } from './diagnostics';
import { useAppUpdates, UpdatesContext, UpdateIndicator, UpdateDialog } from './Updates';

import {sidebarRoutes as routes, orderedSidebar, pageLabels} from './navigation';
const retainedPages: Page[] = [...routes.map(([name]) => name), 'Settings'];
const pageClasses: Partial<Record<Page, string>> = {Settings:'settings-page',Insights:'insights-page',Transcribe:'transcribe-page',Dictionary:'dictionary-page',Customization:'settings-page customization-page'};
export function App() {
  useLocale();
  const updates=useAppUpdates();
  const [data,setData]=useState<Bootstrap>(preview),[page,setPage]=useState<Page>("Dashboard"),[ready,setReady]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[detail,setDetail]=useState<Transcript|null>(null);
  const [setupOpen,setSetupOpen]=useState(false);
  const [transcriptErrorOpen,setTranscriptErrorOpen]=useState(false);
  const [dictationRequest,setDictationRequest]=useState(0);
  const [modelsRequest,setModelsRequest]=useState(0);
  const [historyRequest,setHistoryRequest]=useState(0);
  const [snippetsRequest,setSnippetsRequest]=useState(0);
  useEffect(()=>{recordDiagnostic('info','navigation',{page});},[page]);
  const navigate=useCallback((destination:Page|'History'|'Audio'|'Snippets')=>{
    if(destination==='AI Models'){setModelsRequest(value=>value+1);setPage('Settings');}
    else if(destination==='Audio'){setDictationRequest(value=>value+1);setPage('Settings');}
    else if(destination==='History'){setHistoryRequest(value=>value+1);setPage('Dashboard');}
    else if(destination==='Snippets'){setSnippetsRequest(value=>value+1);setPage('Dictionary');}
    else setPage(destination);
  },[]);
  const [processing,setProcessing]=useState<ReadonlySet<string>>(()=>new Set());
  const processingIds=useRef(new Set<string>());
  const refreshGeneration=useRef(0);
  const [copyNotice,setCopyNotice]=useState<CopyNotice|null>(null);
  const copyId=useRef(0);
  useTheme(data.preferences.palette);
  useLayoutEffect(()=>{if(ready)setUiLanguage(data.preferences.uiLanguage,true,data.systemLocale?[data.systemLocale]:undefined);},[ready,data.preferences.uiLanguage,data.systemLocale]);
  useEffect(()=>{const changed=()=>setUiLanguage(data.preferences.uiLanguage,true,data.systemLocale?[data.systemLocale]:undefined);window.addEventListener('languagechange',changed);return()=>window.removeEventListener('languagechange',changed);},[data.preferences.uiLanguage,data.systemLocale]);
  const prompted=useRef(false);
  const writer=useRef<PreferenceWriter<Preferences>|null>(null);
  if(!writer.current)writer.current=new PreferenceWriter(preview.preferences,(_value,patch)=>call<Preferences>('save_preferences',{patch}),value=>setData(d=>({...d,preferences:value})));

  const refresh=useCallback(async()=>{const generation=++refreshGeneration.current;const next=await call<Bootstrap>('bootstrap');if(generation!==refreshGeneration.current)return;writer.current!.receive(next.preferences);setData(current=>({...next,preferences:writer.current!.value,stats:JSON.stringify(current.stats)===JSON.stringify(next.stats)?current.stats:next.stats}));setReady(true);},[]);
  const notify=useCallback((message:string)=>{setToast(message);},[]);
  const run=useCallback(async<T,>(work:()=>Promise<T>):Promise<T|undefined>=>{try{return await work();}catch(error){recordDiagnostic('error','operation.failed',{error:errorSource(error)});setError(errorSource(error));}},[]);
  const copyWithFeedback=useCallback<CopyWithFeedback>((event,work)=>{
    const anchor=copyAnchor(event);
    void run(async()=>{await work();setCopyNotice({anchor,id:++copyId.current});});
  },[run]);
  useEffect(()=>{if(ready&&native&&!data.onboardingComplete&&!prompted.current){prompted.current=true;setSetupOpen(true);}},[ready,data.onboardingComplete]);
  useEffect(()=>{const open=()=>setSetupOpen(true);window.addEventListener('no-tipe-permissions',open);return()=>window.removeEventListener('no-tipe-permissions',open);},[]);
  useEffect(()=>{void run(refresh);},[refresh,run]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),2200);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!copyNotice)return;const timer=setTimeout(()=>setCopyNotice(null),800);return()=>clearTimeout(timer);},[copyNotice]);
  useEffect(()=>{
    if(!native)return;let disposed=false;const cleanups:(()=>void)[]=[];
    void Promise.all([
      listen<Snapshot>('cloud-state',e=>setData(d=>({...d,snapshot:e.payload}))),
      listen('data-changed',()=>void run(refresh)),listen<string>('app-error',e=>setError(errorSource(e.payload))),
      listen<string>('delivery-notice',e=>setToast(errorSource(e.payload))),
      listen<Page|'History'|'Audio'|'Snippets'>('navigate',e=>navigate(e.payload)),listen('permissions-needed',()=>setSetupOpen(true)),
    ]).then(stops=>{if(disposed)stops.forEach(s=>s());else cleanups.push(...stops);});
    return()=>{disposed=true;cleanups.forEach(s=>s());};
  },[refresh,run,navigate]);
  // Native focus events own foreground tracking; the frontend only reports
  // which view can replace the floating recorder (dialogs cannot).
  useEffect(()=>{
    if(native)void run(()=>call('set_dashboard_active',{active:ready&&page==='Dashboard'&&!setupOpen&&!detail&&!transcriptErrorOpen&&!updates.open}));
  },[ready,page,setupOpen,detail,transcriptErrorOpen,updates.open,run]);
  const save=useCallback((patch:Partial<Preferences>)=>writer.current!.save(patch),[]);
  useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.code==='Comma'){e.preventDefault();setPage('Settings');}};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[]);
  const updateDetail=useCallback((item:Transcript)=>setDetail(current=>current?.id===item.id && JSON.stringify(current)!==JSON.stringify(item)?item:current),[]);
  const processTranscript=useCallback<ProcessTranscript>(async(item,source,configuration)=>{
    if(processingIds.current.has(item.id)||processingBusy(item))return;
    processingIds.current.add(item.id);setProcessing(new Set(processingIds.current));
    try {
      return await run(async()=>{
        const result=await call<Transcript>('retry_transcript',{id:item.id,source,configuration:configuration??null});
        setData(current=>({...current,recent:current.recent.map(t=>t.id===result.id?result:t)}));
        updateDetail(result);
        await refresh();
        return result;
      });
    } finally {
      processingIds.current.delete(item.id);setProcessing(new Set(processingIds.current));
    }
  },[run,refresh,updateDetail]);
  const recognizeTranscript=useCallback<RetryRecognition>(async(item)=>{
    if(processingIds.current.has(item.id)||item.status==='pending'||processingBusy(item))return;
    processingIds.current.add(item.id);setProcessing(new Set(processingIds.current));
    try {
      return await run(async()=>{
        try {
          const result=await call<Transcript|null>('retry_recognition',{id:item.id});
          if(result){updateDetail(result);return result;}
          setDetail(current=>current?.id===item.id?null:current);
        } finally { await refresh(); }
      });
    } finally {
      processingIds.current.delete(item.id);setProcessing(new Set(processingIds.current));
    }
  },[run,refresh,updateDetail]);
  const common={data,refresh,run,notify,save,copyWithFeedback};
  const historyProcessing={processing,onProcess:processTranscript,onRecognize:recognizeTranscript};
  const panelWaveVisible=page==='Dashboard'||(page!=='Insights'&&!data.preferences.dashboardEffectOnly);
  function pageContent(name:Page) {
    switch(name) {
      case 'Dashboard':return <Dashboard {...common} {...historyProcessing} onInsights={()=>setPage('Insights')} historyRequest={historyRequest} onOpen={setDetail}/>;
      case 'Insights':return <Insights {...common} onDictate={()=>setPage('Dashboard')}/>;
      case 'Modes':return <Modes {...common}/>;
      case 'Dictionary':return <Dictionary {...common} snippetsRequest={snippetsRequest}/>;
      case 'Customization':return <Customization {...common}/>;
      case 'Settings':return <Settings {...common} dictationRequest={dictationRequest} modelsRequest={modelsRequest}/>;
      case 'Transcribe':return <Transcribe {...common} settings={page==='Transcription settings'} onSettings={()=>setPage('Transcription settings')} onCredentials={()=>{setDictationRequest(value=>value+1);setPage('Settings');}} onBack={()=>setPage('Transcribe')} onModels={()=>navigate('AI Models')}/>;
    }
  }
  if(!ready)return <div className="onboarding-screen"><div className="loading" role="status">{t('App.opening_your_workspace')}</div></div>;
  if(setupOpen||(native&&!data.onboardingComplete&&!prompted.current))return <PermissionSetup platform={data.platform} canClose={data.onboardingComplete} onClose={()=>{setSetupOpen(false);void run(refresh);}}/>;
  return <TranscriptErrorDialogState.Provider value={setTranscriptErrorOpen}><UpdatesContext.Provider value={updates}><div className="app" data-platform={data.platform}>
    <aside className="sidebar">
      {data.platform==='macos'&&<div className="window-toolbar" data-tauri-drag-region/>}
      <div className="sidebar-header" data-tauri-drag-region>
        <div className="sidebar-header-matrix" aria-hidden>{Array.from({length:150},(_,i)=><i key={i}/>)}</div>
        <div className="sidebar-brand-key" aria-hidden><span><BrandMark/></span></div>
        <span className="sidebar-brand-name" data-tauri-drag-region>{data.appName || "No Type"}</span>
        <UpdateIndicator/>
      </div>
      <div className="sidebar-divider" aria-hidden/>
      <nav id="sidebar-navigation" aria-label={t('App.main_navigation')}>{orderedSidebar(data.preferences).filter(([name])=>!data.preferences.sidebarHidden?.includes(name)).map(([name,icon])=><button key={name} className={`nav-item ${page===name||(page==='Transcription settings'&&name==='Transcribe')?'selected':''}`} onClick={()=>setPage(name)}><Icon name={icon}/><span>{t(pageLabels[name])}</span></button>)}</nav>
      <div className="sidebar-bottom">
        <div className="shortcut-row"><kbd>{shortcutLabel(data.preferences.shortcut,data.platform)}</kbd><span>{data.preferences.shortcutMode==='toggle'?t('App.press_to_dictate'):t('App.hold_to_dictate')}</span></div>
        <AuthorSupport onOpen={()=>void run(()=>openUrl(AUTHOR_BOOSTY_URL))}/>
        <button className={`nav-item settings-nav ${page==='Settings'?'selected':''}`} aria-label={t('common.settings')} onClick={()=>setPage('Settings')}><Icon name="settings"/><span>{t('common.settings')}</span></button>
      </div>
    </aside>
    <main className="main-shell"><div className={`main-panel ${page==='Dashboard'?'dashboard-panel':''}`} data-panel-wave={panelWaveVisible}>
      <DashboardWave snapshot={data.snapshot} visible={panelWaveVisible}/>
      {!ready?<div className="loading" role="status">{t('App.opening_your_workspace')}</div>:retainedPages.map(name=>{
        const active=page===name||(name==='Transcribe'&&page==='Transcription settings');
        return <RetainedView key={name} active={active}><ScrollArea hidden={!active} className={name==='Dashboard'?'dashboard-scroll':'page-scroll'} indicator={name!=='Dashboard'} fadeTop>
          {!native&&<div className="preview-note">{t('App.interface_preview_recording_and_your_library_are_available')}</div>}
          {name==='Dashboard'?pageContent(name):<div className={`page-content ${pageClasses[name]??''}`}>
            {!['Modes','Transcribe','Insights','Dictionary'].includes(name)&&<header className={`page-header${name==='Customization'?' customization-header':''}`}><div><h1>{t(pageLabels[name])}</h1></div>{name==='Customization'&&<RecorderPlacementControl value={data.preferences.recorderPlacement} onChange={recorderPlacement=>void run(()=>save({recorderPlacement}))}/>}</header>}
            <div className="page-body">{pageContent(name)}</div>
          </div>}
        </ScrollArea></RetainedView>;
      })}
    </div>
      <div className="app-notifications">
        {error&&<div className="error-toast" role="alert"><span>{errorMessage(error)}</span><button aria-label={t('App.dismiss_error')} onClick={()=>setError('')}>×</button></div>}
        {toast&&<div className="toast" role="status">{errorMessage(toast)}</div>}
      </div>
    </main>
    {detail&&<TranscriptDetail item={detail} data={data} pending={processing.has(detail.id)} onClose={()=>setDetail(null)} onUpdate={updateDetail} onProcess={processTranscript} onRecognize={recognizeTranscript} copyWithFeedback={copyWithFeedback} refresh={refresh}/>}
    {copyNotice&&<CopyFeedback key={copyNotice.id} notice={copyNotice}/>}
    <UpdateDialog busy={processing.size>0 || data.recent.some(processingBusy) || ['recording','preparing','busy'].includes(data.snapshot.state)}/>
    {native&&data.onboardingComplete&&(data.preferences.usageAnalytics===null||(data.preferences.usageAnalytics===true&&(data.preferences.usageAnalyticsVersion??0)<2))&&<UsageConsent save={save}/>}
  </div></UpdatesContext.Provider></TranscriptErrorDialogState.Provider>;
}
