import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
let deliveredText: typeof import('./api')['deliveredText'];
beforeAll(async () => { vi.stubGlobal('window', {}); ({deliveredText} = await import('./api')); });
afterAll(() => vi.unstubAllGlobals());
describe('delivered transcript text', () => {
  it('preserves the exact saved result used by copy and edit conflict checks', () => {
    expect(deliveredText({text:'original', enhancedText:'  corrected\n'})).toBe('  corrected\n');
  });
  it('falls back to the original only when no meaningful result exists', () => {
    expect(deliveredText({text:'original', enhancedText:' \n '})).toBe('original');
    expect(deliveredText({text:'original', enhancedText:null})).toBe('original');
  });
});
