import { describe, expect, it } from 'vitest';
import { SOURCE_IDS } from '@/lib/sources';
import { JUDGE_MAX_ITEMS, validateAskRequest, validateJudgeRequest } from '@/lib/validate';

describe('search source validation', () => {
  it('deduplicates valid sources while preserving their first occurrence', () => {
    expect(validateAskRequest({ q: ' Bun ', w: '7d', s: ['reddit', 'github', 'reddit', 'invalid', null, 'github'] }))
      .toEqual({ q: 'Bun', w: '7d', s: ['reddit', 'github'] });
  });

  it('allows selecting every supported source once', () => {
    expect(validateAskRequest({ q: 'Bun', s: [...SOURCE_IDS] }).s).toEqual(SOURCE_IDS);
  });

  it('deduplicates a repeated source at the list length limit', () => {
    expect(validateAskRequest({ q: 'Bun', s: Array(SOURCE_IDS.length).fill('reddit') }).s)
      .toEqual(['reddit']);
  });

  it.each(['reddit', 'invalid'])('rejects an oversized list even when it repeats %s', (source) => {
    expect(() => validateAskRequest({ q: 'Bun', s: Array(SOURCE_IDS.length + 1).fill(source) }))
      .toThrow(`s must contain at most ${SOURCE_IDS.length} entries`);
  });

  it('still allows inferred sources when no valid source was selected', () => {
    expect(validateAskRequest({ q: 'Bun', s: ['invalid', null] })).toEqual({ q: 'Bun' });
  });
});

describe('ask Laya validation', () => {
  const item = { id: 'a', title: 'A title', snippet: 'text' };

  it('accepts a question about the results on screen', () => {
    expect(validateJudgeRequest({ q: ' bun ', question: ' Is this docs? ', items: [item] }))
      .toEqual({ q: 'bun', question: 'Is this docs?', items: [item] });
  });

  it('rejects empty or oversized input', () => {
    expect(() => validateJudgeRequest({ q: 'bun', question: 'no', items: [item] })).toThrow(/question/);
    expect(() => validateJudgeRequest({ q: 'bun', question: 'Is it?', items: [] })).toThrow(/items/);
    expect(() => validateJudgeRequest({ q: 'bun', question: 'Is it?', items: Array(JUDGE_MAX_ITEMS + 1).fill(item) })).toThrow(/items/);
    expect(() => validateJudgeRequest({ q: 'bun', question: 'Is it?', items: [{ title: 'x' }] })).toThrow(/id/);
  });
});
