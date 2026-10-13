import { expect, test, vi } from 'vitest';
import { ShortcutCapture } from './shortcutCapture';

test('key release and React cleanup save once and resume only after the replacement is saved',async()=>{
  const calls:string[]=[];
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const capture=new ShortcutCapture(async active=>{calls.push(`active:${active}`);},async value=>{calls.push(`save:${value}`);await pending;});
  await capture.start();
  const saved=capture.finish('Control+Alt+D');
  const cleanup=capture.finish();
  expect(cleanup).toBe(saved);
  await Promise.resolve();
  expect(calls).toEqual(['active:true','save:Control+Alt+D']);
  release();await saved;
  expect(calls).toEqual(['active:true','save:Control+Alt+D','active:false']);
});
test('a registration conflict restores the old shortcut without retrying the invalid edit',async()=>{
  const active=vi.fn().mockResolvedValue(undefined);
  const save=vi.fn().mockRejectedValue(new Error('Shortcut is already registered'));
  const capture=new ShortcutCapture(active,save);
  await capture.start();
  await expect(capture.finish('Control+Alt+D')).rejects.toThrow('already registered');
  await expect(capture.finish()).rejects.toThrow('already registered');
  expect(save).toHaveBeenCalledExactlyOnceWith('Control+Alt+D');
  expect(active.mock.calls).toEqual([[true],[false]]);
});
test('leaving settings while native capture is starting still restores the shortcut',async()=>{
  let ready!:()=>void;
  const start=new Promise<void>(resolve=>{ready=resolve;});
  const active=vi.fn().mockImplementation((value:boolean)=>value?start:Promise.resolve());
  const save=vi.fn();
  const capture=new ShortcutCapture(active,save);
  const starting=capture.start(),cancel=capture.finish();
  ready();await Promise.all([starting,cancel]);
  expect(active.mock.calls).toEqual([[true],[false]]);
  expect(save).not.toHaveBeenCalled();
});
test('a rejected capture start never saves a shortcut',async()=>{
  const active=vi.fn().mockRejectedValue(new Error('Could not suspend shortcut'));
  const save=vi.fn();
  const capture=new ShortcutCapture(active,save);
  await expect(capture.start()).rejects.toThrow('Could not suspend');
  await expect(capture.finish('Control+Alt+D')).rejects.toThrow('Could not suspend');
  expect(active).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
});
