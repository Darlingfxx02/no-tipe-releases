type KeyInput=Pick<KeyboardEvent,'code'|'key'|'ctrlKey'|'altKey'|'shiftKey'|'metaKey'>;
export function defaultShortcut(platform:string):string {
  return platform==='windows'?'ControlRight':'Alt+Space';
}
export function defaultShortcutMode(platform:string):string {
  return platform==='windows'?'pushToTalk':'toggle';
}
export function isWindowsSystemMenuShortcut(value:string):boolean {
  return /^(?:alt|option)\+space$/i.test(value.split('+').map(part=>part.trim()).join('+'));
}
export function isModifierKey(e:Pick<KeyboardEvent,'code'|'key'>):boolean {
  return /^(Alt|Control|Shift|Meta)(Left|Right)$/.test(e.code)||['Alt','AltGraph','Control','Shift','Meta','OS','Fn'].includes(e.key);
}
export function shortcutFromKey(e:KeyInput,platform:string):string|null {
  if(isModifierKey(e))return platform==='macos'?(e.key==='Fn'?'Fn':e.code||null):platform==='windows'&&e.code==='ControlRight'&&!e.altKey&&!e.shiftKey&&!e.metaKey?'ControlRight':null;
  const mods=[e.ctrlKey?'Control':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Super':''].filter(Boolean);
  let key=e.code||(/^[a-z0-9]$/i.test(e.key)?e.key.toUpperCase():e.key===' '?'Space':e.key);
  if(key.startsWith('Key'))key=key.slice(3);else if(key.startsWith('Digit'))key=key.slice(5);
  if(!mods.length&&!/^F(?:[1-9]|1\d|2[0-4])$/.test(key))return null;
  if(!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(key))return null;
  if((platform==='macos'&&e.metaKey&&['Q','W','H'].includes(key))||(e.altKey&&key==='F4'))return null;
  if(platform==='windows'&&(e.metaKey||key==='F12'||(e.altKey&&['Tab','Escape'].includes(key))||(e.altKey&&!e.ctrlKey&&!e.shiftKey&&key==='Space')||(e.ctrlKey&&(key==='Escape'||(e.altKey&&key==='Delete')))))return null;
  return [...mods,key].join('+');
}
export function shortcutLabel(value:string,platform:string):string {
  const mac=platform==='macos';
  const names:Record<string,string>={Super:mac?'⌘':platform==='windows'?'Win':'Super',Control:mac?'⌃':'Ctrl',Alt:mac?'⌥':'Alt',Shift:mac?'⇧':'Shift'};
  names.Meta=names.Super;
  return value.split('+').map(key=>{
    const side=/^(Alt|Control|Shift|Meta)(Left|Right)$/.exec(key);
    return side?`${side[2]} ${names[side[1]]}`:names[key]||key;
  }).join(' + ');
}
