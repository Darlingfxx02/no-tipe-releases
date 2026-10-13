import type { Transcript } from './types';

export const historyPageSize = 50;
export interface HistoryCursor { timestamp: number; id: string }
export interface HistoryRequest { search: string; before: HistoryCursor | null; limit: number }
export interface HistoryState { items: Transcript[]; loading: boolean; more: boolean; error: string }
export const emptyHistory: HistoryState = { items: [], loading: true, more: false, error: '' };

// Each query owns its requests. A late search or refresh response cannot
// overwrite the current list, and concurrent scroll events share one request.
export class TranscriptHistoryPager {
  private generation = 0;
  private search = '';
  private cursor: HistoryCursor | null = null;
  private retryReload = false;
  private state: HistoryState = emptyHistory;

  constructor(private read: (request: HistoryRequest) => Promise<Transcript[]>, private publish: (state: HistoryState) => void, private initialLimit = historyPageSize) {}

  private update(patch: Partial<HistoryState>) {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
  private last(items: Transcript[]): HistoryCursor | null {
    const item = items.at(-1);
    return item ? { timestamp: item.timestamp, id: item.id } : null;
  }
  cancel() { this.generation++; }

  async reload(search: string = this.search) {
    const generation = ++this.generation;
    const sameSearch = search === this.search;
    const target = sameSearch ? Math.max(this.initialLimit, this.state.items.length) : this.initialLimit;
    this.search = search;
    this.retryReload = true;
    this.update({ items: sameSearch ? this.state.items : [], loading: true, error: '' });
    let items: Transcript[] = [], cursor: HistoryCursor | null = null, more = true;
    try {
      // Keep the already opened depth when an entry is edited or deleted.
      // Multiple bounded reads also allow refreshes beyond 500 saved entries.
      while (more && items.length < target) {
        const limit = Math.min(historyPageSize, target - items.length);
        const page = await this.read({ search, before: cursor, limit });
        if (generation !== this.generation) return;
        items = [...items, ...page];
        cursor = this.last(page);
        more = page.length === limit;
      }
      this.cursor = cursor;
      this.update({ items, more, loading: false });
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async loadMore() {
    if (this.state.loading || !this.state.more) return;
    const generation = this.generation;
    this.retryReload = false;
    this.update({ loading: true, error: '' });
    try {
      const page = await this.read({ search: this.search, before: this.cursor, limit: historyPageSize });
      if (generation !== this.generation) return;
      this.cursor = this.last(page) ?? this.cursor;
      const items = new Map(this.state.items.map(item => [item.id, item]));
      page.forEach(item => items.set(item.id, item));
      this.update({ items: [...items.values()], more: page.length === historyPageSize, loading: false });
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  retry() { return this.retryReload ? this.reload() : this.loadMore(); }
}
