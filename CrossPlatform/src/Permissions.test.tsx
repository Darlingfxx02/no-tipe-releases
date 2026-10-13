import {afterEach,expect,test,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Preferences} from './types';
import {setUiLanguage} from './i18n';
const mock=vi.hoisted(()=>({preferences:{shortcut:'Control+Space',shortcutMode:'pushToTalk',alwaysShowCloud:true,recorderPlacement:'island'} as Preferences}));
vi.mock('./api',()=>({native:false,preview:{get preferences(){return mock.preferences;}},call:vi.fn(),errorSource:String,errorMessage:String}));
import {PermissionSetup,OnboardingSettings,OnboardingAppearance} from './Permissions';

function settingsMarkup(platform:string) {
  return renderToStaticMarkup(<OnboardingSettings preferences={mock.preferences} platform={platform} pending={false} captureBusy={false} error="" onChange={async()=>{}} onBusyChange={()=>{}} onRetry={()=>{}}/>);
}

afterEach(()=>setUiLanguage('en',false));
test.each([
  ['Control+Space','pushToTalk','Ctrl + Space'],
  ['Control+Alt+D','toggle','Ctrl + Alt + D'],
  ['Control+Shift+F8','hybrid','Ctrl + Shift + F8'],
])('setup displays persisted Windows shortcut %s and behavior %s', (shortcut,shortcutMode,label)=>{
  setUiLanguage('en',false);
  mock.preferences={shortcut,shortcutMode} as Preferences;
  const html=settingsMarkup('windows');
  expect(html).toContain(label);
  expect(html).toContain('aria-label="Shortcut behavior"');
  expect(html).toContain('Choose a comfortable shortcut');
});
test('setup keeps macOS modifier shortcuts and translates onboarding instructions',()=>{
  setUiLanguage('ru',false);
  mock.preferences={shortcut:'AltRight',shortcutMode:'toggle'} as Preferences;
  const html=settingsMarkup('macos');
  expect(html).toContain('Right ⌥');
  expect(html).toContain('Выберите удобные клавиши');
});
test('a saved Windows system-menu shortcut stays visible with an actionable warning',()=>{
  setUiLanguage('en',false);
  mock.preferences={shortcut:'Alt+Space',shortcutMode:'toggle'} as Preferences;
  const html=settingsMarkup('windows');
  expect(html).toContain('Alt + Space');
  expect(html).toContain('Alt + Space opens the Windows system menu. Choose another shortcut, such as Right Ctrl.');
});

test('setup starts with permissions and leaves settings for the second step',()=>{
  setUiLanguage('en',false);
  const html=renderToStaticMarkup(<PermissionSetup platform="windows" onClose={()=>{}}/>);
  expect(html).toContain('class="onboarding-screen"');
  expect(html).toContain('<h1>Set up permissions</h1>');
  expect(html).not.toContain('<dialog');
  expect(html).toContain('aria-current="step"');
  expect(html).toContain('aria-label="Shortcut and behavior"');
  expect(html).toContain('aria-label="Recorder appearance"');
  expect(html).toContain('Microphone');
  expect(html).toContain('disabled="">Continue');
  expect(html).not.toContain('Record dictation shortcut');
  expect(html).not.toContain('aria-label="Show recorder"');
  expect(html).not.toContain('>Done</button>');
  expect(html).not.toContain('If the microphone is unavailable');
});
test('first onboarding step defaults to declined sharing and needs expanded consent',()=>{
  setUiLanguage('en',false);
  for(const preferences of [{usageAnalytics:null,usageAnalyticsVersion:0},{usageAnalytics:false,usageAnalyticsVersion:2},{usageAnalytics:true,usageAnalyticsVersion:1}]){
    mock.preferences=preferences as Preferences;
    const html=renderToStaticMarkup(<PermissionSetup platform="windows" onClose={()=>{}}/>);
    const checkbox=html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
    expect(checkbox).toContain('aria-label="Share usage statistics"');
    expect(checkbox).not.toContain('checked');
  }
  mock.preferences={usageAnalytics:true,usageAnalyticsVersion:2} as Preferences;
  expect(renderToStaticMarkup(<PermissionSetup platform="windows" onClose={()=>{}}/>)).toMatch(/<input[^>]*checked=""/);
});
test('appearance controls live in the third step and reflect saved choices',()=>{
  setUiLanguage('ru',false);
  mock.preferences={shortcut:'Alt+Space',shortcutMode:'toggle',alwaysShowCloud:false,recorderPlacement:'notch',recorderStyle:'liquid',palette:'aurora'} as Preferences;
  const html=renderToStaticMarkup(<OnboardingAppearance preferences={mock.preferences} pending={false} error="" onChange={async()=>{}} onRetry={()=>{}}/>);
  expect(html).toContain('aria-label="Показывать рекордер"');
  expect(html).toContain('aria-label="Положение рекордера"');
  expect(html).toContain('aria-label="Стиль рекордера"');
  expect(html).toContain('aria-label="Цветовая тема"');
  expect(html).toContain('aria-label="Aurora" aria-pressed="true"');
  expect(settingsMarkup('macos')).not.toContain('aria-label="Показывать рекордер"');
  expect(html).not.toContain('Разрешить');
});
