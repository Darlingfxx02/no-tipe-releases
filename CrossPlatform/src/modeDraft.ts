import { t } from './i18n';
import type { Mode } from './types';

export type DraftStatus = 'saved' | 'pending' | 'saving' | 'error';

// Keep failed drafts available when navigating away and returning to Modes.
export const modeDrafts = new Map<string, Mode>();
export class ModeDraft {
  value: Mode;
  private savedValue: Mode;
  private revision = 0;
  private savedRevision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private work?: Promise<void>;
  constructor(value: Mode, private persist: (mode: Mode) => Promise<void>, private changed: (status: DraftStatus, error?: unknown) => void) {
    this.savedValue = structuredClone(value);
    this.value = structuredClone(modeDrafts.get(value.id) ?? value);
    if (modeDrafts.has(value.id)) this.revision++;
  }
  get hasChanges(): boolean {
    return JSON.stringify(this.value) !== JSON.stringify(this.savedValue);
  }
  update(patch: Partial<Mode>) {
    const next = {...this.value, ...patch};
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    this.revision++;
    modeDrafts.set(this.value.id, this.value);
    this.changed('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.work) return this.work;
    this.work = this.drain();
    try { await this.work; } finally { this.work = undefined; }
  }
  private async drain() {
    while (this.savedRevision < this.revision) {
      const revision = this.revision, value = structuredClone(this.value);
      if (!this.hasChanges) { this.savedRevision = revision; continue; }
      this.changed('saving');
      try {
        if (!value.name.trim()) throw new Error(t('modeDraft.give_this_mode_a_name'));
        await this.persist({...value, name: value.name.trim()});
        this.savedValue = value;
        this.savedRevision = revision;
      } catch (error) { this.changed('error', error); throw error; }
    }
    modeDrafts.delete(this.value.id);
    this.changed('saved');
  }
}
