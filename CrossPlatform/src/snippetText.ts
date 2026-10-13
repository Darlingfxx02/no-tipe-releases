import { t } from './i18n';
import type { SnippetStyle } from './types';
export const characterCount = (text:string) => Array.from(text).length;
export const normalizedTrigger = (text:string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function snippetError(trigger:string, expansion:string) {
  if (!normalizedTrigger(trigger)) return t('snippetText.enter_a_spoken_phrase_containing_letters_or_numbers');
  if (characterCount(trigger.trim())>60) return t('snippetText.use_up_to_60_characters_for_the_spoken');
  if (!expansion.trim()) return t('snippetText.enter_the_text_to_insert');
  if (characterCount(expansion)>4000) return t('snippetText.use_up_to_4_000_characters_for_the');
  return '';
}
export function readEditor(root:HTMLElement):{text:string;formatting:SnippetStyle[]} {
  let text=''; const formatting:SnippetStyle[]=[];
  function append(value:string,style:Omit<SnippetStyle,'start'|'end'>) {
    if (!value) return;
    const start=text.length; text+=value;
    if (style.bold||style.italic||style.link) formatting.push({start,end:text.length,...style});
  }
  function walk(node:Node,style:Omit<SnippetStyle,'start'|'end'>) {
    if (node.nodeType===Node.TEXT_NODE) {append(node.textContent??'',style);return;}
    if (!(node instanceof HTMLElement)) return;
    const tag=node.tagName.toLowerCase();
    if (['script','style','img','iframe'].includes(tag)) return;
    const link=tag==='a'&&/^(https?:|mailto:)/i.test(node.getAttribute('href')??'')?node.getAttribute('href'):style.link;
    const next={bold:style.bold||['b','strong'].includes(tag)||/^(bold|[6-9]00)$/.test(node.style.fontWeight),italic:style.italic||['i','em'].includes(tag)||node.style.fontStyle==='italic',link};
    if (tag==='br') {append('\n',style);return;}
    if (['div','p','li','ul','ol'].includes(tag)&&text&&!text.endsWith('\n')) append('\n',style);
    if (tag==='li') append(node.parentElement?.tagName==='OL'?`${Array.from(node.parentElement.children).indexOf(node)+1}. `:'• ',next);
    Array.from(node.childNodes).forEach(child=>walk(child,next));
  }
  Array.from(root.childNodes).forEach(node=>walk(node,{bold:false,italic:false,link:null}));
  return {text,formatting};
}
export function fillEditor(root:HTMLElement,text:string,formatting:SnippetStyle[]) {
  root.replaceChildren(); let offset=0;
  for (const style of formatting) {
    if (style.start<offset||style.end>text.length) continue;
    root.append(document.createTextNode(text.slice(offset,style.start)));
    let node:Node=document.createTextNode(text.slice(style.start,style.end));
    for (const tag of [...(style.bold?['strong']:[]),...(style.italic?['em']:[]),...(style.link?['a']:[])]) {
      const element=document.createElement(tag);
      if (tag==='a'&&/^(https?:|mailto:)/i.test(style.link??'')) element.setAttribute('href',style.link!);
      element.append(node);node=element;
    }
    root.append(node);offset=style.end;
  }
  root.append(document.createTextNode(text.slice(offset)));
}
