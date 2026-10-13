import {installSideRecorder,sideRecorderCss} from './side-recorder-adapter.js';
const $=selector=>document.querySelector(selector);
const anchor=$('#anchor'),screen=$('#screen'),frame=$('#pill-frame');
let placement='right',menuOpen=true,languageOpen=false,paused=false,style='liquid',translation='off',phase='recording',replayTimer,finishTimer,ready=false;
const processing={enhance:true,shorten:false};
const snapshots=()=>({state:phase,paused,showTranscript:false,hiddenStyle:'split',transcript:'',translation:'off',enhance:processing.enhance,shorten:processing.shorten,palette:'prism',recorderStyle:style,recorderScale:1,previewAudio:true,lightIntensity:.38,waveBrightness:.65,showDictationWaves:true});
function sync(){if(!ready)return;frame.contentWindow.noTipe.update(snapshots());frame.contentWindow.sideRecorder.placement(placement);frame.contentWindow.sideRecorder.menu(menuOpen);frame.contentWindow.sideRecorder.language(translation);}
frame.addEventListener('load',()=>{if(!frame.contentWindow.sideRecorder)return;ready=true;sync();document.documentElement.dataset.ready='true';});
const response=await fetch('/cloud.html');if(!response.ok)throw new Error('Не удалось загрузить рендер пилюли');
const recorder=(await response.text()).replace("const previewHost=new URLSearchParams(location.search).has('preview');","const previewHost=true;").replace("const previewParentOrigin=location.protocol==='tauri:'?'*':location.origin;","const previewParentOrigin=parent.location.origin;");
const controllerEnd="})();\n</script><script>\nif(new URLSearchParams";
if(!recorder.includes(controllerEnd))throw new Error('Не найдена граница контроллера пилюли');
frame.srcdoc=recorder.replace('</head>',`<style>${sideRecorderCss}</style></head>`).replace(controllerEnd,`(${installSideRecorder.toString()})();\n${controllerEnd}`);
function choosePlacement(value){placement=value;anchor.dataset.placement=value;document.querySelectorAll('button[data-placement]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.placement===value)));$('#placement-label').textContent={left:'У левого края',right:'У правого края',bottom:'У нижнего края'}[value];sync();}
function setLanguage(open){languageOpen=open;anchor.dataset.language=String(open);$('#languages').hidden=!open;$('#language').setAttribute('aria-expanded',String(open));}
function setMenu(open){menuOpen=open;anchor.dataset.menu=String(open);$('#menu').setAttribute('aria-expanded',String(open));$('#language').tabIndex=open?0:-1;$('.caption-hint').textContent=open?'Нажмите четыре квадратика, чтобы свернуть меню':'Нажмите четыре квадратика, чтобы открыть настройки';if(!open)setLanguage(false);sync();}
function setPaused(value){paused=value;phase='recording';sync();$('#pause').setAttribute('aria-label',paused?'Продолжить диктовку':'Приостановить диктовку');$('#pause').title=$('#pause').getAttribute('aria-label');$('#phase-label').textContent=paused?'На паузе':'Диктовка';$('.recording-dot').style.opacity=paused?'.35':'1';$('.caret').style.animationPlayState=paused?'paused':'running';}
$('#pause').onclick=()=>{clearTimeout(finishTimer);setPaused(!paused);};
$('#menu').onclick=()=>{if(phase!=='recording')setPaused(false);setMenu(!menuOpen);};
$('#language').onclick=()=>setLanguage(!languageOpen);
$('#finish').onclick=()=>{if(phase!=='recording'){setPaused(false);return;}setMenu(false);phase='preparing';sync();$('#phase-label').textContent='Обработка';finishTimer=setTimeout(()=>{phase='result';sync();$('#phase-label').textContent='Текст вставлен';finishTimer=setTimeout(()=>setPaused(false),1600);},1100);};
document.querySelectorAll('button[data-placement]').forEach(button=>button.onclick=()=>{clearTimeout(replayTimer);choosePlacement(button.dataset.placement);});
document.querySelectorAll('button[data-style]').forEach(button=>button.onclick=()=>{style=button.dataset.style;document.querySelectorAll('button[data-style]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));sync();});
document.querySelectorAll('button[data-language]').forEach(button=>button.onclick=()=>{translation=button.dataset.language;document.querySelectorAll('button[data-language]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));$('#language').dataset.enabled=String(translation!=='off');$('#language').title={off:'Выбрать язык перевода',english:'Перевод на английский',russian:'Перевод на русский'}[translation];sync();setLanguage(false);$('#language').focus();});
$('#scale').onchange=event=>document.documentElement.style.setProperty('--scale',event.target.value);
$('#replay').onclick=()=>{clearTimeout(replayTimer);const destination=placement==='bottom'?'right':placement;setMenu(false);choosePlacement('bottom');replayTimer=setTimeout(()=>{choosePlacement(destination);replayTimer=setTimeout(()=>setMenu(true),850);},950);};
$('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():screen.requestFullscreen();
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(languageOpen){setLanguage(false);$('#language').focus();}else{setMenu(false);$('#menu').focus();}}});
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='no-tipe-action')return;if(event.data.action==='processing')processing[event.data.detail.value]=event.data.detail.enabled;if(event.data.action==='side-language')setLanguage(!languageOpen);if(event.data.action==='pause')setPaused(!paused);if(event.data.action==='cancel')setMenu(false);});
window.addEventListener('pointerdown',event=>{if(languageOpen&&!event.target.closest('#languages, #language'))setLanguage(false);});
window.addEventListener('pagehide',()=>{clearTimeout(replayTimer);clearTimeout(finishTimer);frame.contentWindow.noTipe?.active(false);});
