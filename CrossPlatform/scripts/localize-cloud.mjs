import {readFileSync} from 'node:fs';

// The historical recorder source is shared with the native implementation.
// Convert its copy to stable catalog keys at build time, never by DOM text lookup.
const messages = {
 'Усилители':'Empowerments.title',
 'Без усилителя':'Empowerments.none', 'Пробрифовать':'Empowerments.brief',
 'Готов к диктовке':'cloud.ready', 'Слушаю':'Notch.listening', 'Подготовка':'Notch.preparing',
 'Вставлено':'Dashboard.inserted', 'Текст в буфере обмена':'cloud.copied',
 'Другая запись активна':'cloud.busy', 'Не удалось обработать':'cloud.failed',
 'Без перевода':'common.no_translation', 'На английский':'fileTranscription.to_english',
 'Английский':'common.english', 'На русский':'fileTranscription.to_russian', 'Русский':'common.russian',
 'Улучшение текста':'Modes.improve_text', 'Сокращение':'common.shorten',
 'На паузе':'Dashboard.paused', 'Предыдущий текст скрыт сверху':'LiveTranscript.previous_text_is_hidden_above',
 'Исходный диктованный текст':'TranscriptDetail.original_dictation', 'Настройки диктовки':'Notch.dictation_settings',
 'Обработка':'Settings.processing', 'Перевод':'Modes.translation',
 'Выбрать язык перевода':'cloud.choose_translation', 'Язык перевода':'Notch.translation_language',
 'Выключить перевод':'Notch.turn_off_translation', 'Включить перевод':'Notch.turn_on_translation',
 'Вернуться к тексту':'cloud.return_text', 'Вернуться к записи':'cloud.return_recording',
 'Отменить обработку':'cloud.cancel_processing', 'Остановить запись':'cloud.stop_recording',
 'Повторить попытку':'common.retry', 'Закрыть результат':'cloud.close_result', 'Начать запись':'cloud.start_recording',
 'Продолжить диктовку':'Notch.resume_dictation', 'Приостановить диктовку':'Notch.pause_dictation',
 'Готово. Закрыть':'cloud.done_close', 'Текст в буфере обмена. Закрыть':'cloud.copied_close',
 'Ошибка. Вернуться в ожидание':'cloud.error_idle', 'Подготовка. Отменить обработку':'cloud.preparing_cancel',
 'Готово':'common.done', 'Голос':'cloud.voice', 'Готово. Вернуться в ожидание':'cloud.done_idle',
 'Завершить диктовку':'Notch.finish_dictation',
};
export function localizeCloud(html) {
 const catalogs=Object.fromEntries(['en','ru'].map(language=>{
  const catalog=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'));
  return [language,{translation:Object.fromEntries([...new Set(Object.values(messages))].map(key=>{
   if(!catalog[key])throw new Error(`Missing recorder translation: ${language}:${key}`);
   return [key,catalog[key]];
  }))}];
 }));
 for(const [original,key] of Object.entries(messages)) {
  html=html.replaceAll(`'${original}'`,`recorderT('${key}')`);
  for(const attribute of ['aria-label','title'])html=html.replaceAll(`${attribute}="${original}"`,`${attribute}="\${recorderT('${key}')}" data-i18n-${attribute}="${key}"`);
 }
 const tables=['labels','translations','processingNames'].map(name=>{
  const expression=new RegExp(`const ${name}=(.*?);`);const found=html.match(expression);
  if(!found)throw new Error(`Missing recorder ${name} table`);
  html=html.replace(expression,`let ${name}=$1;`);
  return `${name}=${found[1]};`;
 }).join('\n');
 const i18next=readFileSync(new URL('../node_modules/i18next/dist/umd/i18next.min.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
 const runtime=`${i18next}\nconst recorderI18n=i18next.createInstance();
recorderI18n.init({resources:${JSON.stringify(catalogs).replaceAll('<','\\u003c')},lng:navigator.language.toLowerCase().startsWith('ru')?'ru':'en',fallbackLng:'en',keySeparator:false,initAsync:false,interpolation:{escapeValue:false}});
const recorderT=key=>recorderI18n.t(key);
document.documentElement.lang=recorderI18n.language;
`;
 html=html.replace('<script>',`<script>${runtime}</script><script>`);
 const apply=`
function applyRecorderLanguage(preference){
 const next=preference==='ru'||preference==='en'?preference:navigator.language.toLowerCase().startsWith('ru')?'ru':'en';
 if(recorderI18n.language===next)return;
 recorderI18n.changeLanguage(next);document.documentElement.lang=next;
 ${tables}
}
function refreshRecorderCopy(){
 for(const attribute of ['aria-label','title'])root.querySelectorAll('[data-i18n-'+attribute+']').forEach(node=>node.setAttribute(attribute,recorderT(node.getAttribute('data-i18n-'+attribute))));
 root.querySelectorAll('[data-setting="processing"]').forEach(node=>{node.querySelector('span').textContent=processingNames[node.dataset.value];});
 root.querySelectorAll('[data-setting="translation"]').forEach(node=>{const entry=translations[node.dataset.value];node.querySelector('.language-full').textContent=entry.chip;node.setAttribute('aria-label',entry.name);node.title=entry.name;});
}
`;
 html=html.replace('window.noTipe={',`${apply}\nwindow.noTipe={`);
 html=html.replace(' update(snapshot){',' update(snapshot){\n  applyRecorderLanguage(snapshot.uiLanguage);');
 html=html.replace('  render();\n  reportHitRegions();','  render();\n  refreshRecorderCopy();\n  reportHitRegions();');
 return html;
}
