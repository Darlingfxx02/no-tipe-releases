import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));
const catalogs=Object.fromEntries(['en','ru'].map(code=>[code,JSON.parse(readFileSync(path.join(root,'src/locales',`${code}.json`),'utf8'))]));
const errors=[];
const placeholders=text=>[...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map(match=>match[1]).sort().join(',');
const keys=Object.keys(catalogs.en).sort();
for(const [code,catalog] of Object.entries(catalogs)) {
  const seen=new Set();
  for(const match of readFileSync(path.join(root,'src/locales',`${code}.json`),'utf8').matchAll(/^\s*"([^"]+)"\s*:/gm)) {
    if(seen.has(match[1]))errors.push(`${code}: duplicate key ${match[1]}`);
    seen.add(match[1]);
  }
  for(const key of new Set([...keys,...Object.keys(catalog)])) {
    if(typeof catalog[key]!=='string'||!catalog[key].trim())errors.push(`${code}: missing or empty ${key}`);
    else if(!Object.hasOwn(catalogs.en,key))errors.push(`${code}: extra ${key}`);
    else if(placeholders(catalog[key])!==placeholders(catalogs.en[key]))errors.push(`${code}: interpolation differs for ${key}`);
  }
  for(const key of keys.filter(key=>key.endsWith('_other'))) {
    const base=key.slice(0,-6);
    for(const form of new Intl.PluralRules(code).resolvedOptions().pluralCategories) {
      if(!Object.hasOwn(catalog,`${base}_${form}`))errors.push(`${code}: missing plural ${base}_${form}`);
    }
  }
}

// Product names, formats and symbols are deliberately language-neutral.
const neutral=/^(No Type|Boosty|GitHub|Hugging Face|i|GB|MB|WAV, MP3, M4A, FLAC, AAC, OGG, MP4|API|GGUF|CoreML|Whisper|Ollama|MIT|Apache 2\.0|TXT|SRT|VTT|JSON|CSV|Markdown|English|Русский|USB|\d+\s*(?:%|×|MB|GB))$/;
const preview=/^(PixelPreview|UnicodePreview|SidePreview)\./;
function walk(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='recorder'&&entry.name!=='locales')walk(filename);continue;}
    if(!/\.tsx?$/.test(entry.name)||/\.(test|d)\./.test(entry.name)||preview.test(entry.name)||entry.name.includes('preview-main'))continue;
    const source=ts.createSourceFile(filename,readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,entry.name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function report(copy,node) {
      if(copy&&/\p{L}/u.test(copy)&&!neutral.test(copy)) {
        const {line}=source.getLineAndCharacterOfPosition(node.getStart(source));
        errors.push(`${path.relative(root,filename)}:${line+1}: put UI copy in the catalog: ${JSON.stringify(copy)}`);
      }
    }
    function outputCopy(expression) {
      if(ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression))report(expression.text.trim(),expression);
      if(ts.isTemplateExpression(expression))report((expression.head.text+expression.templateSpans.map(span=>span.literal.text).join('')).trim(),expression);
      if(ts.isConditionalExpression(expression)){outputCopy(expression.whenTrue);outputCopy(expression.whenFalse);}
      if(ts.isBinaryExpression(expression)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind))outputCopy(expression.right);
    }
    function inspect(node) {
      let copy;
      if(ts.isJsxText(node))copy=node.text.trim();
      if(ts.isJsxAttribute(node)&&/^(aria-label|title|placeholder|alt|label)$/.test(node.name.getText(source))&&node.initializer&&ts.isStringLiteral(node.initializer))copy=node.initializer.text.trim();
      if(ts.isJsxExpression(node)&&node.expression&&(!ts.isJsxAttribute(node.parent)||/^(aria-label|title|placeholder|alt|label)$/.test(node.parent.name.getText(source))))outputCopy(node.expression);
      report(copy,node);
      ts.forEachChild(node,inspect);
    }
    inspect(source);
  }
}
walk(path.join(root,'src'));
function checkNative(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if(entry.isDirectory()){checkNative(filename);continue;}
    if(!filename.endsWith('.rs'))continue;
    const source=readFileSync(filename,'utf8');
    for(const match of source.matchAll(/localization::(?:message|message_with_values)\("([^"]+)"(?:\)|,)/g)) {
      if(!Object.hasOwn(catalogs.en,match[1]))errors.push(`${path.relative(root,filename)}: unknown native message ${match[1]}`);
    }
  }
}
checkNative(path.join(root,'src-tauri/src'));
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`Localization OK: ${keys.length} keys, English/Russian parity, interpolation, plural forms and UI copy.`);
