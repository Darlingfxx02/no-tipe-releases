// One app shader owns the panel, pause/menu circles and language orb.
export function installSideRecorder(){
  const oldGeometry=updateGeometry,oldSplit=renderer.updateSplitControls.bind(renderer),oldLayout=renderer.layout.bind(renderer);
  const side=()=>document.documentElement.dataset.edgePlacement!=='bottom';
  const direction=()=>document.documentElement.dataset.edgePlacement==='right'?1:-1;
  updateGeometry=function(){
    oldGeometry();if(!side())return;
    const shell=root.querySelector('.shell'),width=settingsOpen?198:90,height=settingsOpen?310:63;
    shell.style.width=width+'px';shell.style.height=height+'px';root.style.setProperty('--height',height+'px');root.dataset.currentSize=width+'x'+height;
  };
  renderer.updateSplitControls=function(delta,shell){
    if(!side())return oldSplit(delta,shell);
    this.splitPresence.setTarget(state==='recording'?1:0);
    if(reduce.matches||paused)this.splitPresence.jump(this.splitPresence.target);else this.splitPresence.step(delta);
    const presence=Math.max(0,Math.min(1,this.splitPresence.value)),{width:w,height:h}=shell.getBoundingClientRect();
    const record=w/2+direction()*77*presence,menu=w/2-direction()*77*presence;
    root.style.setProperty('--split-left',record+'px');root.style.setProperty('--split-right',menu+'px');root.style.setProperty('--split-hit-size','44px');
    this.controlProgress=presence;this.controlGeometry=[record,menu].map(x=>({x,y:h-31.5,radius:22*presence}));
    const phase=Math.max(0,Math.min(1,(presence-.15)/.6));setCloudControlsReveal(phase*phase*(3-2*phase));
  };
  renderer.layout=function(surface,sizes){
    if(!side())return oldLayout(surface,sizes);
    const shell=root.querySelector('.shell').getBoundingClientRect();this.expansion=Math.max(0,Math.min(1,(shell.height-63)/247));
    const result=oldLayout(surface,sizes),d=this.dpr,effectW=90*1.18*d,effectH=63*1.18*d;
    return {...result,effectWidth:Math.round(effectW),effectHeight:Math.round(effectH),effectOrigin:[this.shellOrigin[0]*d+(shell.width*d-effectW)/2,this.shellOrigin[1]*d+shell.height*d-31.5*d-effectH/2],effectSize:[effectW,effectH]};
  };
  window.sideRecorder={placement(value){document.documentElement.dataset.edgePlacement=value;render();},menu(value){settingsOpen=value;translationPickerOpen=false;render();},language(value){translation=value;translationPickerOpen=false;syncSettings();}};
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="translation-picker"]')){event.preventDefault();event.stopImmediatePropagation();post('side-language');}},true);
  document.documentElement.dataset.edgePlacement='right';
  const heading=()=>{if(!root.querySelector('.side-settings-heading'))root.querySelector('.settings-content')?.insertAdjacentHTML('afterbegin','<div class="side-settings-heading"><h2>Настройки диктовки</h2><span>Обработка текста</span></div>');};
  new MutationObserver(heading).observe(root,{childList:true,subtree:true});render();
}

export const sideRecorderCss=`
html,body{overflow:hidden!important}body{display:block!important;padding:0!important}.design{position:absolute!important;left:50%;top:50%;width:500px!important;height:0!important;transform:translateX(-50%);max-width:none!important}.shell{position:absolute!important;left:50%;bottom:-31.5px;transform:translateX(-50%)}
.side-settings-heading h2{font-size:13px;font-weight:500;line-height:1.4;margin:0 0 6px;color:#eeebf5}.side-settings-heading>span{font-size:9px;color:#90859e}.settings-content{gap:14px!important}.processing-options{gap:5px!important}.setting-option{font-size:12px!important;height:34px!important}.setting-switch{width:35px!important;height:21px!important}.setting-switch::after{width:15px!important;height:15px!important}.setting-option[aria-checked="true"] .setting-switch::after{transform:translateX(14px)!important}.inline-settings{mask-image:none!important;overflow:visible!important}.settings-content{animation:none!important}.settings-blur-zone{display:none!important}
html:not([data-edge-placement="bottom"]) .reading{position:absolute;left:50%;top:calc((100% - 63px)/2);width:200px;height:146px;padding:0!important;margin:0!important;flex:none;overflow:visible;opacity:var(--controls-reveal);transform:translate(-50%,-50%) rotate(90deg)}html[data-edge-placement="left"] .reading{transform:translate(-50%,-50%) rotate(-90deg)}
html:not([data-edge-placement="bottom"]) .toolbar button :is(svg,canvas),html:not([data-edge-placement="bottom"]) .language-toggle-glyph{transform:rotate(90deg)!important}html[data-edge-placement="left"] .toolbar button :is(svg,canvas),html[data-edge-placement="left"] .language-toggle-glyph{transform:rotate(-90deg)!important}
html:not([data-edge-placement="bottom"]) .language-chips{inset:0;display:block;width:100%;height:100%;pointer-events:none}html:not([data-edge-placement="bottom"]) .language-chips::before{display:none}html:not([data-edge-placement="bottom"]) .language-chip--icon{left:calc(50% + 123px);top:calc(100% - 53.5px);bottom:auto;width:44px;height:44px;pointer-events:auto}html[data-edge-placement="left"] .language-chip--icon{left:calc(50% - 167px)}.language-options{display:none!important}
html:not([data-edge-placement="bottom"]) .reading .text-scroll{display:none!important}
`;
