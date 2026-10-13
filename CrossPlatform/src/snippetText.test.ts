import { describe, expect, it } from 'vitest';
import { characterCount, normalizedTrigger, snippetError } from './snippetText';
describe('snippet editor validation',()=>{
  it('counts Unicode characters consistently with the backend',()=>{expect(characterCount('🎤 моя подпись')).toBe(13);expect(normalizedTrigger('МОЯ — подпись!')).toBe('мояподпись');});
  it('rejects empty, punctuation-only and oversized fields',()=>{
    expect(snippetError('!!!','Text')).toBeTruthy();expect(snippetError('my signature',' \n ')).toBeTruthy();
    expect(snippetError('a'.repeat(61),'Text')).toBeTruthy();expect(snippetError('my signature','a'.repeat(4001))).toBeTruthy();
    expect(snippetError('my signature','  Alex\nDesigner  ')).toBe('');
  });
});
