import { describe, expect, it, vi } from 'vitest';
import { TranscriptHistoryPager, type HistoryRequest, type HistoryState } from './transcriptHistory';
import type { Transcript } from './types';

const entries = (count:number, start=0) => Array.from({length:count},(_,index) => ({id:`entry-${index+start}`,timestamp:10000-index-start,text:`Dictation ${index+start}`} as Transcript));
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; }
function setup(read:(request:HistoryRequest)=>Promise<Transcript[]>) {
  let state!:HistoryState;
  const pager = new TranscriptHistoryPager(read,next=>{state=next;});
  return {pager,get state(){return state;}};
}

describe('scrolling saved transcripts',()=>{
  it('starts the dashboard with ten entries and continues from the tenth without repeating them',async()=>{
    const read=vi.fn().mockResolvedValueOnce(entries(10)).mockResolvedValueOnce(entries(50,10));
    let state!:HistoryState;
    const pager=new TranscriptHistoryPager(read,next=>{state=next;},10);
    await pager.reload(); expect(state.items).toHaveLength(10); expect(state.more).toBe(true);
    expect(read.mock.calls[0][0]).toEqual({search:'',before:null,limit:10});
    await pager.loadMore(); expect(state.items).toHaveLength(60);
    expect(new Set(state.items.map(item=>item.id)).size).toBe(60);
    expect(read.mock.calls[1][0]).toEqual({search:'',before:{timestamp:9991,id:'entry-9'},limit:50});
  });
  it('appends bounded pages and stops at the last retained entry',async()=>{
    const read=vi.fn().mockResolvedValueOnce(entries(50)).mockResolvedValueOnce(entries(12,50));
    const view=setup(read); await view.pager.reload(); await view.pager.loadMore(); await view.pager.loadMore();
    expect(view.state.items).toHaveLength(62); expect(view.state.more).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toEqual({search:'',before:{timestamp:9951,id:'entry-49'},limit:50});
  });
  it('coalesces repeated scroll events while a page is loading',async()=>{
    const pending=deferred<Transcript[]>();
    const read=vi.fn().mockResolvedValueOnce(entries(50)).mockReturnValueOnce(pending.promise);
    const view=setup(read); await view.pager.reload();
    const first=view.pager.loadMore(); await view.pager.loadMore(); await view.pager.loadMore();
    expect(read).toHaveBeenCalledTimes(2); pending.resolve(entries(2,50)); await first;
    expect(view.state.items).toHaveLength(52);
  });
  it('ignores late search and scroll responses after a new query',async()=>{
    const oldSearch=deferred<Transcript[]>(),oldPage=deferred<Transcript[]>();
    const read=vi.fn().mockReturnValueOnce(oldSearch.promise).mockResolvedValueOnce(entries(50)).mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(entries(1,300));
    const view=setup(read),first=view.pager.reload('old');
    await view.pager.reload('new'); oldSearch.resolve(entries(1,100)); await first;
    expect(view.state.items).toHaveLength(50);
    const scroll=view.pager.loadMore(); await view.pager.reload('latest'); oldPage.resolve(entries(50,50)); await scroll;
    expect(view.state.items.map(item=>item.id)).toEqual(['entry-300']); expect(view.state.loading).toBe(false);
  });
  it('retries the failed page using the same cursor and keeps loaded text',async()=>{
    const read=vi.fn().mockResolvedValueOnce(entries(50)).mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce(entries(1,50));
    const view=setup(read); await view.pager.reload(); await view.pager.loadMore();
    expect(view.state.items).toHaveLength(50); expect(view.state.error).toBe('Read failed');
    await view.pager.retry(); expect(read.mock.calls[2]).toEqual(read.mock.calls[1]);
    expect(view.state.items).toHaveLength(51); expect(view.state.error).toBe('');
  });
  it('refreshes an opened depth beyond 500 entries without limiting saved history',async()=>{
    const read=vi.fn(async({before}:HistoryRequest)=>entries(50,before?Number(before.id.slice(6))+1:0));
    const view=setup(read); await view.pager.reload();
    for(let page=0;page<10;page++)await view.pager.loadMore();
    expect(view.state.items).toHaveLength(550);
    read.mockClear(); await view.pager.reload();
    expect(view.state.items).toHaveLength(550); expect(read).toHaveBeenCalledTimes(11);
    expect(read.mock.calls.every(([request])=>request.limit===50)).toBe(true);
  });
  it('ignores canceled requests after the dialog closes',async()=>{
    const pending=deferred<Transcript[]>(),publish=vi.fn();
    const pager=new TranscriptHistoryPager(()=>pending.promise,publish);
    const request=pager.reload(); pager.cancel(); pending.resolve(entries(5)); await request;
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
