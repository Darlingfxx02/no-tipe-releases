import {afterEach, describe, expect, it, vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {i18n, locale, resolveLocale, setUiLanguage, t, translateMessage, formatNumber, cachedLanguage, localePreferenceKey} from './i18n';
import {voiceNarrative} from './voiceNarrative';
import {modelLanguages} from './modelMetadata';
import {ModelIndicators} from './ModelIndicators';

afterEach(()=>{vi.unstubAllGlobals();setUiLanguage('en',false);});
describe('interface localization',()=>{
  it('resolves explicit, regional and unsupported system languages',()=>{
    expect(resolveLocale('en',['ru-RU'])).toBe('en');
    expect(resolveLocale('ru',['en-US'])).toBe('ru');
    for(const code of ['ru-RU','ru_RU','RU'])expect(resolveLocale('system',[code])).toBe('ru');
    expect(resolveLocale('system',['fr-FR','ru'])).toBe('en');
    expect(resolveLocale('system',[])).toBe('en');
  });
  it('switches copy and retained model indicators',()=>{
    setUiLanguage('ru',false);
    expect(locale()).toBe('ru');
    expect(t('common.cancel')).toBe('Отмена');
    expect(renderToStaticMarkup(createElement(ModelIndicators,{name:'Custom',comparison:null}))).toContain('Скорость');
    setUiLanguage('en',false);
    expect(renderToStaticMarkup(createElement(ModelIndicators,{name:'Custom',comparison:null}))).toContain('Speed');
  });
  it('caches the preference rather than the resolved system locale',()=>{
    const cache=new Map<string,string>();
    vi.stubGlobal('localStorage',{getItem:(key:string)=>cache.get(key)??null,setItem:(key:string,value:string)=>cache.set(key,value)});
    expect(cachedLanguage()).toBe('system');
    setUiLanguage('ru');
    expect(cachedLanguage()).toBe('ru');
    expect(cache.get(localePreferenceKey)).toBe('ru');
    setUiLanguage('system',true,['ru-RU']);
    expect(cachedLanguage()).toBe('system');
    expect(locale()).toBe('ru');
    cache.set(localePreferenceKey,'unsupported');
    expect(cachedLanguage()).toBe('system');
  });
  it('uses language-specific cardinal plural forms and number formatting',()=>{
    setUiLanguage('ru',false);
    expect([1,2,5,21,22,25].map(count=>t('common.count_words',{count}))).toEqual(['1 слово','2 слова','5 слов','21 слово','22 слова','25 слов']);
    expect(formatNumber(1.5)).toBe('1,5');
    setUiLanguage('en',false);
    expect(t('common.count_words',{count:1})).toBe('1 word');
    expect(t('common.count_words',{count:2})).toBe('2 words');
    expect(formatNumber(1.5)).toBe('1.5');
  });
  it('translates native message identifiers and preserves provider diagnostics',()=>{
    setUiLanguage('ru',false);
    expect(translateMessage('no-tipe-i18n:native.quit')).toBe('Выйти');
    expect(translateMessage('HTTP 429: provider quota')).toBe('HTTP 429: provider quota');
    expect(translateMessage('no-tipe-i18n:unknown')).toBe('no-tipe-i18n:unknown');
    expect(translateMessage('no-tipe-i18n:'+JSON.stringify({key:'native.provider.http',values:{status:503}}))).toBe('Сервис вернул HTTP 503');
    expect(translateMessage('no-tipe-i18n:'+JSON.stringify({key:'native.live_translation_failed',values:{error:'no-tipe-i18n:native.no_speech'}}))).toBe('Ошибка перевода во время транскрибации: Речь не обнаружена');
    expect(translateMessage('no-tipe-i18n:null')).toBe('no-tipe-i18n:null');
  });
  it('falls back to English for unknown locales',async()=>{
    await i18n.changeLanguage('fr');
    expect(t('common.cancel')).toBe('Cancel');
  });
  it('localizes catalog language metadata',()=>{
    setUiLanguage('ru',false);
    expect(modelLanguages({languages:'Multilingual'} as never)).toBe('Многоязычная');
    expect(modelLanguages({languages:'English'} as never)).toBe('Английский');
  });
  it('localizes prepared voice profiles and preserves generated content',()=>{
    setUiLanguage('ru',false);
    const profile={theme:'design',method:'patterns',sampledWords:2000,sampledSessions:10,title:'Detail-driven designer',description:'English description'} as const;
    expect(voiceNarrative(profile as never).title).toBe('Дизайнер деталей');
    expect(voiceNarrative({...profile,method:'localModel'} as never).description).toBe('English description');
  });
});
