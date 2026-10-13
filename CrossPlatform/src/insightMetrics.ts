import { t, locale } from './i18n';
import type { Statistics } from './types';

export type InsightPeriod = '7' | '30' | '90' | 'all';
export type ActivityMetric = 'words' | 'saved' | 'sessions';
export type ActivityDay = Statistics['daily'][number];
export type ActivityBucket = ActivityDay & { end: string };
export const emptyStatistics: Statistics = { words: 0, duration: 0, savedSeconds: 0, sessions: 0, speedWords: 0, speedSeconds: 0, speedSamples: 0, daily: [], models: [] };
export const getPeriodNames = (): Record<InsightPeriod, string> => ({ '7': t('insightMetrics.last_7_days'), '30': t('insightMetrics.last_30_days'), '90': t('insightMetrics.last_90_days'), all: t('insightMetrics.all_time') });
const dayInMs = 86_400_000;

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDay(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}
export function dayDistance(start: Date, end: Date) {
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / dayInMs);
}
export function periodRange(period: InsightPeriod, now = new Date()) {
  const today = parseDay(dayKey(now));
  const start = period === 'all' ? new Date(0) : addDays(today, 1 - Number(period));
  // The previous window ends at the same local time as the current partial day.
  const previousStart = period === 'all' ? start : addDays(start, -Number(period));
  const previousEnd = period === 'all' ? now : addDays(now, -Number(period));
  return { since: period === 'all' ? 0 : start.getTime() / 1000, until: now.getTime() / 1000 + .001, previousSince: previousStart.getTime() / 1000, previousUntil: previousEnd.getTime() / 1000 + .001, start, end: today };
}
export function fillDays(daily: ActivityDay[], start: Date, end: Date): ActivityDay[] {
  const indexed = new Map(daily.map(day => [day.date, day]));
  const days: ActivityDay[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const date = dayKey(cursor);
    days.push(indexed.get(date) ?? { date, words: 0, seconds: 0, sessions: 0 });
  }
  return days;
}
export function activityBuckets(days: ActivityDay[]): { buckets: ActivityBucket[]; grouping: string } {
  const unit = days.length > 120 ? 'month' : days.length > 45 ? 'week' : 'day';
  const groups: ActivityBucket[] = [];
  let lastKey = '';
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const key = unit === 'month' ? day.date.slice(0, 7) : unit === 'week' ? String(Math.floor(i / 7)) : day.date;
    if (key !== lastKey) { groups.push({ ...day, end: day.date }); lastKey = key; }
    else { const group = groups[groups.length - 1]; group.words += day.words; group.seconds += day.seconds; group.sessions += day.sessions; group.end = day.date; }
  }
  return { buckets: groups, grouping: unit === 'month' ? t('insightMetrics.monthly') : unit === 'week' ? t('insightMetrics.weekly') : t('insightMetrics.daily') };
}
export function savedSeconds(words: number, seconds: number, typingWpm: number) {
  return Math.max(0, words / typingWpm * 60 - seconds);
}
export function activityValue(day: ActivityDay, metric: ActivityMetric, typingWpm: number) {
  return metric === 'saved' ? savedSeconds(day.words, day.seconds, typingWpm) : day[metric];
}
export function speechWpm(stats: Statistics) {
  return (stats.speedSeconds ?? 0) > 0 ? Math.round((stats.speedWords ?? 0) / stats.speedSeconds! * 60) : 0;
}
export function changePercent(current: number, previous: number) {
  return previous > 0 ? Math.round((current - previous) / previous * 100) : null;
}
export function activityStreaks(daily: ActivityDay[], now = new Date()) {
  const today = dayKey(now);
  const active = daily.filter(day => day.words > 0 && day.date <= today).map(day => day.date).sort();
  let longest = 0, run = 0, last = '';
  for (const key of active) {
    run = last && dayDistance(parseDay(last), parseDay(key)) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run); last = key;
  }
  const keys = new Set(active);
  let cursor = parseDay(today), current = 0;
  if (!keys.has(today)) cursor = addDays(cursor, -1);
  while (keys.has(dayKey(cursor))) { current++; cursor = addDays(cursor, -1); }
  return { current, longest, activeDays: active.length };
}
export function wordMilestone(words: number) {
  const targets = [500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 125_000, 250_000, 500_000, 1_000_000];
  const target = targets.find(value => value > words) ?? (Math.floor(words / 1_000_000) + 1) * 1_000_000;
  return { target, remaining: target - words, progress: Math.min(1, words / target) };
}
export function compactNumber(value: number) {
  return Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
export function timeLabel(seconds: number) {
  if (seconds <= 0) return t('common.time_minutes',{minutes:0});
  if (seconds < 60) return t('common.time_under_minute');
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? t('common.time_hours_minutes',{hours:Math.floor(minutes/60),minutes:minutes%60}) : t('common.time_minutes',{minutes});
}

export const getUsageCategories = () => ([
  { id: 'other', label: t('insightMetrics.other_tasks'), icon: 'other' },
  { id: 'ai', label: t('insightMetrics.ai_prompts'), icon: 'ai' },
  { id: 'documents', label: t('insightMetrics.documents'), icon: 'document' },
  { id: 'personal', label: t('insightMetrics.personal_messages'), icon: 'personal' },
  { id: 'email', label: t('insightMetrics.emails'), icon: 'email' },
  { id: 'work', label: t('insightMetrics.work_messages'), icon: 'work' },
] as const);
export function desktopUsage(applications: NonNullable<Statistics['applications']>) {
  // Categories describe the captured application. Browsers stay in Other tasks
  // because no tab titles, URLs or message contents are collected.
  const category = (id: string) => {
    const app = id.toLowerCase();
    if (/openai|chatgpt|anthropic|claude/.test(app)) return 'ai';
    if (/apple\.mail|outlook|thunderbird|mimestream/.test(app)) return 'email';
    if (/slack|microsoft\.teams/.test(app)) return 'work';
    if (/telegram|whatsapp|signal|apple\.ichat/.test(app)) return 'personal';
    if (/microsoft\.word|iwork\.pages|apple\.notes|obsidian|notion/.test(app)) return 'documents';
    return 'other';
  };
  const total = applications.reduce((sum, app) => sum + app.sessions, 0);
  return getUsageCategories().map(item => {
    const apps = applications.filter(app => category(app.id) === item.id);
    const sessions = apps.reduce((sum, app) => sum + app.sessions, 0);
    return { ...item, sessions, percent: total ? sessions / total * 100 : 0, applications: apps };
  });
}
