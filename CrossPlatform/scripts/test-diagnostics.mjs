import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../src-tauri/src/diagnostics.js', import.meta.url), 'utf8');
async function harness(status = true) {
  const calls = [], handlers = new Map(), original = [];
  let modeChanged;
  const window = {
    addEventListener: (name, callback) => handlers.set(name, callback),
    __TAURI_INTERNALS__: {
      transformCallback: callback => { modeChanged = callback; return 1; },
      invoke: async (command, args) => { calls.push({command,args}); return command === 'developer_status' ? status : 1; },
    },
  };
  const console = Object.fromEntries(['debug','log','info','warn','error'].map(name => [name,(...args) => original.push({name,args})]));
  runInNewContext(source, {window,console,Error});
  await new Promise(resolve => setImmediate(resolve));
  return {window,console,calls,handlers,original,modeChanged};
}
test('captures console errors and rejected promises in either webview only when enabled', async () => {
  const {window,console,calls,handlers,original,modeChanged} = await harness(false);
  console.warn('disabled');
  assert.equal(calls.filter(call => call.command === 'developer_client_event').length, 0);
  modeChanged({payload:true});
  console.error(new Error('shader failed'));
  console.log({text:'private transcript',apiKey:'private key'});
  handlers.get('unhandledrejection')({reason:new Error('worker failed')});
  const events = calls.filter(call => call.command === 'developer_client_event').map(call => call.args);
  assert.equal(events.length,3);
  assert.equal(events[0].details.message,'shader failed');
  assert.equal(events[1].details.message,'Console object omitted');
  assert.equal(events[2].message,'promise.unhandled');
  assert(!JSON.stringify(events).includes('private transcript'));
  assert.equal(original.length,3);
  window.__noTypeDiagnostics.setEnabled(false);
  handlers.get('error')({message:'ignored',lineno:12});
  assert.equal(calls.filter(call => call.command === 'developer_client_event').length,3);
});
test('keeps the actual exception and stack when a renderer prefixes its console error', async () => {
  const {console,calls} = await harness(true);
  console.error('Pixel recorder:',new Error('context lost'));
  const event=calls.find(call => call.command === 'developer_client_event').args;
  assert.equal(event.details.message,'Pixel recorder: context lost');
  assert(event.details.stack.includes('context lost'));
});
test('mode changes received during status hydration win over an older status reply', async () => {
  let callback, resolveStatus;
  const window = {addEventListener() {},__TAURI_INTERNALS__:{
    transformCallback: handler => {callback=handler;return 1;},
    invoke: command => command === 'developer_status' ? new Promise(resolve => {resolveStatus=resolve;}) : Promise.resolve(1),
  }};
  const console = Object.fromEntries(['debug','log','info','warn','error'].map(name => [name,() => {}]));
  runInNewContext(source,{window,console,Error});
  await new Promise(resolve => setImmediate(resolve));
  callback({payload:true});
  resolveStatus(false);
  await new Promise(resolve => setImmediate(resolve));
  const calls=[];
  window.__TAURI_INTERNALS__.invoke=async (command,args)=>{calls.push({command,args});};
  window.__noTypeDiagnostics.report('info','still-enabled');
  assert.equal(calls[0].args.message,'still-enabled');
});
