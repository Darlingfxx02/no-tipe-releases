import { afterEach, expect, test, vi } from 'vitest';
import { ModeDraft, modeDrafts } from './modeDraft';
import type { Mode } from './types';
const initial = {id:'test-mode',name:'Notes',prompt:'Original',enhance:false} as Mode;
afterEach(()=>{modeDrafts.clear();vi.useRealTimers();});
test('leaving an untouched new draft never persists a mode',async()=>{
  const persist=vi.fn().mockResolvedValue(undefined),writer=new ModeDraft({...initial,name:'New mode',prompt:''},persist,()=>{});
  await writer.flush();
  expect(persist).not.toHaveBeenCalled();expect(writer.hasChanges).toBe(false);
  expect(modeDrafts.has(initial.id)).toBe(false);
});
test('unchanged fields and equivalent rule lists do not schedule a save',async()=>{
  vi.useFakeTimers();const mode={...initial,appPatterns:['com.apple.Notes']};
  const persist=vi.fn().mockResolvedValue(undefined),writer=new ModeDraft(mode,persist,()=>{});
  writer.update({});writer.update({name:mode.name,appPatterns:[...mode.appPatterns]});
  await vi.advanceTimersByTimeAsync(600);await writer.flush();
  expect(persist).not.toHaveBeenCalled();expect(writer.hasChanges).toBe(false);
  expect(modeDrafts.has(initial.id)).toBe(false);
});
test('reverting edits before autosave leaves no new mode behind',async()=>{
  vi.useFakeTimers();const persist=vi.fn().mockResolvedValue(undefined),writer=new ModeDraft(initial,persist,()=>{});
  writer.update({prompt:'A temporary edit'});expect(writer.hasChanges).toBe(true);
  writer.update({prompt:initial.prompt});await writer.flush();
  expect(persist).not.toHaveBeenCalled();expect(writer.hasChanges).toBe(false);
  expect(modeDrafts.has(initial.id)).toBe(false);
});
test('coalesces typing and flushes the latest draft before leaving',async()=>{
  vi.useFakeTimers();const persist=vi.fn().mockResolvedValue(undefined), writer=new ModeDraft(initial,persist,()=>{});
  writer.update({prompt:'First'});writer.update({prompt:'Final'});writer.update({enhance:true});
  expect(persist).not.toHaveBeenCalled();await writer.flush();
  expect(persist).toHaveBeenCalledExactlyOnceWith({...initial,prompt:'Final',enhance:true});
  expect(modeDrafts.has(initial.id)).toBe(false);
});
test('edits made during a slow write are persisted afterwards without racing',async()=>{
  vi.useFakeTimers();let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}), writes:Mode[]=[];
  const writer=new ModeDraft(initial,async mode=>{writes.push(mode);if(writes.length===1)await gate;},()=>{});
  writer.update({prompt:'First'});const pending=writer.flush();writer.update({prompt:'Latest',enhance:true});release();await pending;
  expect(writes.map(m=>m.prompt)).toEqual(['First','Latest']);expect(writes[1].enhance).toBe(true);
});
test('keeps a failed draft for recovery and supports retry',async()=>{
  vi.useFakeTimers();const persist=vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  const writer=new ModeDraft(initial,persist,()=>{});writer.update({prompt:'Keep this'});
  await expect(writer.flush()).rejects.toThrow('Disk full');
  expect(new ModeDraft(initial,persist,()=>{}).value.prompt).toBe('Keep this');
  await writer.flush();expect(modeDrafts.has(initial.id)).toBe(false);
});
