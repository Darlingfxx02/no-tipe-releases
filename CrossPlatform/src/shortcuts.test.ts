import { expect,test } from 'vitest';
import { defaultShortcut,defaultShortcutMode,isModifierKey,isWindowsSystemMenuShortcut,shortcutFromKey,shortcutLabel } from './shortcuts';
import { detectPlatform } from './platform';
const key=(code:string,flags:object={},character='')=>({code,key:character,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,...flags});
test('records physical keys even with a Russian keyboard layout',()=>{
  for(const platform of ['macos','windows'])expect(shortcutFromKey(key('KeyD',{ctrlKey:true,altKey:true},'в'),platform)).toBe('Control+Alt+D');
});
test('recognizes right and left modifiers separately',()=>{
  expect(shortcutFromKey(key('AltRight',{altKey:true},'Alt'),'macos')).toBe('AltRight');
  expect(shortcutLabel('AltRight','macos')).toBe('Right ⌥');
  expect(shortcutFromKey(key('MetaLeft',{metaKey:true},'Meta'),'macos')).toBe('MetaLeft');
});
test('rejects ordinary typing and reserved system combinations',()=>{
  expect(shortcutFromKey(key('KeyA',{},'a'),'macos')).toBeNull();
  expect(shortcutFromKey(key('KeyQ',{metaKey:true},'q'),'macos')).toBeNull();
  for(const platform of ['macos','windows']) {
    expect(shortcutFromKey(key('F4',{altKey:true},'F4'),platform)).toBeNull();
    expect(shortcutFromKey(key('Space',{altKey:true},' '),platform)).toBe(platform==='windows'?null:'Alt+Space');
  }
});
test('uses Windows key names throughout shortcut labels',()=>{
  expect(shortcutLabel(defaultShortcut('windows'),'windows')).toBe('Right Ctrl');
  expect(shortcutLabel('Alt+Space','windows')).toBe('Alt + Space');
  expect(shortcutLabel('Control+Alt+D','windows')).toBe('Ctrl + Alt + D');
  expect(shortcutLabel('Control+Shift+Super+D','windows')).toBe('Ctrl + Shift + Win + D');
  expect(shortcutLabel('AltRight','windows')).toBe('Right Alt');
  expect(shortcutLabel('ControlLeft','windows')).toBe('Left Ctrl');
  expect(shortcutLabel('MetaLeft','windows')).toBe('Left Win');
  expect(shortcutLabel('ShiftRight','windows')).toBe('Right Shift');
  expect(shortcutLabel('Control+Shift+Super+D','macos')).toBe('⌃ + ⇧ + ⌘ + D');
  expect(shortcutLabel('Super+D','linux')).toBe('Super + D');
});
test('new installations and shortcut resets use the platform defaults',()=>{
  expect(defaultShortcut('windows')).toBe('ControlRight');
  expect(defaultShortcutMode('windows')).toBe('pushToTalk');
  for(const platform of ['macos','linux','preview']){
    expect(defaultShortcut(platform)).toBe('Alt+Space');
    expect(defaultShortcutMode(platform)).toBe('toggle');
  }
});
test('the Windows default captures only the right Control modifier',()=>{
  expect(shortcutFromKey(key('ControlRight',{ctrlKey:true},'Control'),'windows')).toBe(defaultShortcut('windows'));
  expect(shortcutFromKey(key('ControlLeft',{ctrlKey:true},'Control'),'windows')).toBeNull();
  expect(shortcutFromKey(key('ControlRight',{ctrlKey:true,altKey:true},'Control'),'windows')).toBeNull();
});
test('Windows reserves its system menu shortcut while preserving distinct Space combinations',()=>{
  for(const value of ['Alt+Space','alt+space','Option + Space'])expect(isWindowsSystemMenuShortcut(value)).toBe(true);
  for(const value of ['Control+Space','Control+Alt+Space','Alt+Shift+Space'])expect(isWindowsSystemMenuShortcut(value)).toBe(false);
  expect(shortcutFromKey(key('Space',{altKey:true},' '),'windows')).toBeNull();
  expect(shortcutFromKey(key('Space',{ctrlKey:true},' '),'windows')).toBe('Control+Space');
  expect(shortcutFromKey(key('Space',{ctrlKey:true,altKey:true},' '),'windows')).toBe('Control+Alt+Space');
  expect(shortcutFromKey(key('Space',{altKey:true,shiftKey:true},' '),'windows')).toBe('Alt+Shift+Space');
});
test('Windows capture requires a regular key instead of a macOS-only modifier',()=>{
  for(const code of ['AltLeft','AltRight','ControlLeft','ShiftLeft','ShiftRight','MetaLeft','MetaRight'])expect(shortcutFromKey(key(code),'windows')).toBeNull();
  expect(shortcutFromKey(key('',{},'Fn'),'windows')).toBeNull();
  expect(shortcutFromKey(key('',{},'Fn'),'macos')).toBe('Fn');
  expect(shortcutFromKey(key('KeyD',{ctrlKey:true,altKey:true},'d'),'windows')).toBe('Control+Alt+D');
  expect(shortcutFromKey(key('F8',{},'F8'),'windows')).toBe('F8');
});
test('detects the platform before native bootstrap',()=>{
  expect(detectPlatform({platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})).toBe('windows');
  expect(detectPlatform({platform:'',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})).toBe('windows');
  expect(detectPlatform({platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)'})).toBe('macos');
  expect(detectPlatform({platform:'Linux x86_64',userAgent:'Mozilla/5.0 (X11; Linux x86_64)'})).toBe('linux');
  expect(detectPlatform(undefined)).toBe('preview');
});
test('Windows rejects reserved shortcuts and accepts extended keyboards',()=>{
  for(const [code,flags] of [
    ['KeyD',{metaKey:true}],['F12',{}],['F12',{ctrlKey:true}],
    ['Tab',{altKey:true}],['Escape',{altKey:true}],['Escape',{ctrlKey:true,shiftKey:true}],
    ['Delete',{ctrlKey:true,altKey:true}],['F0',{}],['F25',{}],
  ] as const)expect(shortcutFromKey(key(code,flags),'windows')).toBeNull();
  expect(shortcutFromKey(key('Numpad1',{ctrlKey:true,altKey:true}),'windows')).toBe('Control+Alt+Numpad1');
  expect(shortcutFromKey(key('NumpadAdd',{ctrlKey:true}),'windows')).toBe('Control+NumpadAdd');
  expect(shortcutFromKey(key('F24',{}),'windows')).toBe('F24');
  expect(shortcutFromKey(key('F12',{}),'macos')).toBe('F12');
});
test('handles modifier events and ordinary keys with a missing browser code',()=>{
  expect(isModifierKey(key('',{},'Control'))).toBe(true);
  expect(isModifierKey(key('',{},'AltGraph'))).toBe(true);
  expect(shortcutFromKey(key('',{ctrlKey:true,altKey:true},'d'),'windows')).toBe('Control+Alt+D');
  expect(shortcutFromKey(key('',{altKey:true},' '),'windows')).toBeNull();
  expect(shortcutFromKey(key('',{ctrlKey:true},' '),'windows')).toBe('Control+Space');
  expect(shortcutFromKey(key('',{ctrlKey:true},'в'),'windows')).toBeNull();
});
