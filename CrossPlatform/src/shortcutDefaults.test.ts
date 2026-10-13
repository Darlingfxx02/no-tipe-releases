import {afterEach,expect,test,vi} from 'vitest';

afterEach(()=>vi.unstubAllGlobals());
test.each([
  ['Win32','Windows NT 10.0','windows','ControlRight','pushToTalk'],
  ['MacIntel','Macintosh','macos','Alt+Space','toggle'],
])('pre-bootstrap and preview settings agree for %s',async(platform,userAgent,os,shortcut,shortcutMode)=>{
  vi.resetModules();
  vi.stubGlobal('window',{});
  vi.stubGlobal('navigator',{platform,userAgent,languages:['en-US']});
  const {defaults,preview,call}=await import('./api');
  expect(defaults).toMatchObject({shortcut,shortcutMode});
  expect(preview).toMatchObject({platform:os,preferences:{shortcut,shortcutMode},snapshot:{shortcut,shortcutMode}});
  expect(await call('bootstrap')).toMatchObject({platform:os,preferences:{shortcut,shortcutMode}});
});
