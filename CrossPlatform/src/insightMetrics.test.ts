import { describe, it, expect, test } from 'vitest';
import { desktopUsage, activityBuckets, activityStreaks, addDays, changePercent, dayKey, emptyStatistics, fillDays, periodRange, savedSeconds, speechWpm, wordMilestone } from './insightMetrics';

test('periods include local today and compare at the same time, with calendar arithmetic', () => {
  const now = new Date(2026, 8, 30, 14, 35);
  const range = periodRange('7', now);
  expect(dayKey(range.start)).toBe('2026-09-24');
  expect(new Date(range.previousUntil * 1000).getHours()).toBe(14);
  expect(dayKey(new Date(range.previousUntil * 1000))).toBe('2026-09-23');
  expect(dayKey(new Date(range.previousSince * 1000))).toBe('2026-09-17');
  expect(fillDays([], range.start, range.end)).toHaveLength(7);
  // A DST transition must not add or drop a calendar day.
  const fall = new Date(2026, 9, 30);
  expect(fillDays([], fall, addDays(fall, 6))).toHaveLength(7);
  expect(periodRange('all', now).since).toBe(0);
});
test('inactive days remain zero and grouping preserves every recorded word and session', () => {
  const daily = [{ date: '2026-01-02', words: 200, seconds: 30, sessions: 2 }];
  const days = fillDays(daily, new Date(2026, 0, 1), new Date(2026, 5, 1));
  expect(days[0].words).toBe(0);
  const { buckets, grouping } = activityBuckets(days);
  expect(grouping).toBe('Monthly');
  expect(buckets.reduce((sum, day) => sum + day.words, 0)).toBe(200);
  expect(buckets.reduce((sum, day) => sum + day.sessions, 0)).toBe(2);
  expect(daily[0].words).toBe(200);
  expect(activityBuckets(days.slice(0, 90)).grouping).toBe('Weekly');
});
test('streak grants today a grace period, breaks on gaps and excludes future activity', () => {
  const days = ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-10-01'].map(date => ({ date, words: 1, seconds: 1, sessions: 1 }));
  expect(activityStreaks(days, new Date(2026, 8, 30))).toEqual({ current: 2, longest: 2, activeDays: 4 });
  expect(activityStreaks(days, new Date(2026, 9, 3)).current).toBe(0);
  expect(activityStreaks([], new Date(2026, 8, 30)).longest).toBe(0);
});
test('missing speed and baseline do not produce fabricated percentages or infinities', () => {
  expect(speechWpm(emptyStatistics)).toBe(0);
  expect(speechWpm({ ...emptyStatistics, speedWords: 90, speedSeconds: 30 })).toBe(180);
  expect(changePercent(500, 0)).toBeNull();
  expect(changePercent(150, 100)).toBe(50);
  expect(savedSeconds(10, 60, 40)).toBe(0);
  expect(savedSeconds(100, 30, 40)).toBe(120);
});
test('milestone advances at the boundary instead of remaining at 100%', () => {
  expect(wordMilestone(0).target).toBe(500);
  expect(wordMilestone(100_000).target).toBe(125_000);
  expect(wordMilestone(1_000_000).target).toBe(2_000_000);
});

describe('desktop application usage', () => {
  it('groups known applications and keeps browser sessions in other tasks', () => {
    const rows = desktopUsage([
      {id:'com.openai.chat', sessions:3, words:90},
      {id:'com.apple.Safari', sessions:2, words:60},
      {id:'com.apple.mail', sessions:1, words:30},
      {id:'com.tinyspeck.slackmacgap', sessions:2, words:60},
      {id:'notion.id', sessions:2, words:60},
    ]);
    expect(rows.find(row => row.id === 'ai')?.percent).toBe(30);
    expect(rows.find(row => row.id === 'other')?.sessions).toBe(2);
    expect(rows.find(row => row.id === 'work')?.sessions).toBe(2);
    expect(rows.reduce((sum,row)=>sum+row.sessions,0)).toBe(10);
    expect(rows.reduce((sum,row)=>sum+row.percent,0)).toBe(100);
    expect(desktopUsage([]).every(row=>row.percent===0)).toBe(true);
  });
});
