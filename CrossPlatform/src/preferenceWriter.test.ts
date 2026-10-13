import { expect, test } from 'vitest';
import { PreferenceWriter } from './preferenceWriter';

test('rapid changes in separate rows do not overwrite one another',async()=>{
  const writes:{palette:string;enhance:boolean}[]=[];
  let release!:()=>void;
  const first=new Promise<void>(r=>{release=r;});
  const writer=new PreferenceWriter({palette:'indigo',enhance:false},async value=>{writes.push(value);if(writes.length===1)await first;},()=>{});
  const a=writer.save({palette:'cyan'}),b=writer.save({enhance:true});
  expect(writer.value).toEqual({palette:'cyan',enhance:true});release();await Promise.all([a,b]);
  expect(writes.at(-1)).toEqual({palette:'cyan',enhance:true});
});
test('a rejected field rolls back without losing a newer valid switch',async()=>{
  let calls=0;const writes:object[]=[];
  const writer=new PreferenceWriter({endpoint:'https://valid.test',enhance:false},async value=>{writes.push(value);if(++calls===1)throw new Error('Invalid endpoint');},()=>{});
  const bad=writer.save({endpoint:'bad'}).catch(e=>e.message),good=writer.save({enhance:true});
  expect(await bad).toBe('Invalid endpoint');await good;
  expect(writer.value).toEqual({endpoint:'https://valid.test',enhance:true});
  expect(writes.at(-1)).toEqual(writer.value);
});
test('a translation changed in the cloud survives an in-flight settings write',async()=>{
  let release!:(value:{palette:string;translation:string})=>void;
  const response=new Promise<{palette:string;translation:string}>(r=>{release=r;});
  const patches:object[]=[];
  const writer=new PreferenceWriter({palette:'indigo',translation:'off'},async(_value,patch)=>{patches.push(patch);return response;},()=>{});
  const write=writer.save({palette:'cyan'});
  writer.receive({palette:'cyan',translation:'english'});
  release({palette:'cyan',translation:'off'});await write;
  expect(patches).toEqual([{palette:'cyan'}]);
  expect(writer.value).toEqual({palette:'cyan',translation:'english'});
});
