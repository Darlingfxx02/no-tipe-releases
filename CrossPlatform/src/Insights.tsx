import { t, useLocale, locale, formatNumber } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { call, native, errorSource } from './api';
import type { Statistics, VoiceReport } from './types';
import type { Props } from './pages';
import { Select, SelectOption } from './Select';
import {NoTypeTabs} from './DesignControls';
import { SettingInput } from './SettingInput';
import { Empty, Modal, Panel } from './ui';
import { activityBuckets, activityStreaks, activityValue, addDays, dayKey, changePercent, compactNumber, desktopUsage, emptyStatistics, fillDays, parseDay, getPeriodNames, periodRange, savedSeconds, speechWpm, timeLabel, wordMilestone } from './insightMetrics';
import type { ActivityBucket, ActivityDay, ActivityMetric, InsightPeriod } from './insightMetrics';
import { InsightHint as Hint } from './InsightHint';
import { VoiceProfile, voiceProfileSummary } from './VoiceProfile';
import { RetainedView, useViewActive } from './RetainedView';
import { InsightGauge } from './InsightGauge';
import './insights.css';

const number = (value: number) => formatNumber(value);
const shortDate = (key: string) => parseDay(key).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
const fullDate = (key: string) => parseDay(key).toLocaleDateString(locale(), { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const getMetricNames = (): Record<ActivityMetric, string> => ({ words: t('Insights.words'), saved: t('Insights.time_saved'), sessions: t('Insights.sessions') });

type GlyphName = 'copy' | 'share' | 'chevron' | 'desktop' | 'other' | 'ai' | 'document' | 'personal' | 'email' | 'work' | 'trend';
function Glyph({ name }: { name: GlyphName }) {
  const paths: Record<GlyphName, ReactNode> = {
    copy: <><rect x="7" y="7" width="10" height="11" rx="2" /><path d="M13 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
    share: <><path d="M10 13V2m-4 4 4-4 4 4M5 9H3v9h14V9h-2" /></>,
    chevron: <path d="m8 5 5 5-5 5" />,
    desktop: <><rect x="2" y="3" width="16" height="11" rx="2" /><path d="M7 18h6M10 14v4" /></>,
    other: <path d="M10 10c-2-4-8-4-8 0s6 4 8 0 8-4 8 0-6 4-8 0Z" />,
    ai: <><rect x="3" y="6" width="14" height="11" rx="3" /><path d="M10 6V2M8 2h4M1 10v3M19 10v3M7 10v3M13 10v3" /></>,
    document: <><path d="M12 2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" /><path d="M12 2v5h5M7 11h6M7 14h6" /></>,
    personal: <><path d="M17 13a8 8 0 1 0-14-1l-1 6 6-1a8 8 0 0 0 9-4Z" /><path d="M6 9h.1M10 9h.1M14 9h.1" /></>,
    email: <><rect x="2" y="4" width="16" height="12" rx="2" /><path d="m2 5 8 6 8-6" /></>,
    work: <><path d="M5 3h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7l-5 2V5a2 2 0 0 1 3-2Z" /><path d="M6 7h8M6 10h8M6 13h4" /></>,
    trend: <path d="m2 14 5-5 4 3 7-8M12 4h6v6" />,
  };
  return <svg className="insight-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
function UsageCalendar({ daily, now }: { daily: ActivityDay[]; now: Date }) {
  useLocale();
  const [offset, setOffset] = useState(0), [weeks, setWeeks] = useState(18), [selected, setSelected] = useState<string | null>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const active = useViewActive();
  useLayoutEffect(() => {
    const element = calendar.current; if (!element || !active) return;
    const measure = (width: number) => {
      if (width > 0) setWeeks(Math.max(10, Math.min(22, Math.floor((width - 42) / 23))));
    };
    // Retained pages/tabs have zero width while hidden. Keep their last grid,
    // then measure the visible width before the first frame on each return.
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => measure(entries[0].contentRect.width));
    observer.observe(element); return () => observer.disconnect();
  }, [active]);
  const today = parseDay(dayKey(now)), streak = activityStreaks(daily, now);
  const sunday = addDays(today, -today.getDay()), start = addDays(sunday, -7 * (weeks - 1 + offset));
  const days = fillDays(daily, start, addDays(start, weeks * 7 - 1));
  const earliest = daily[0]?.date ?? dayKey(today), selectedDay = days.find(day => day.date === selected);
  return <Panel className="insight-calendar">
    <div className="insight-lower-head"><h2>{t('Insights.streak',{count:streak.current})}</h2><span className="insight-eyebrow">{t('Insights.longest_streak')} <b>{t('common.count_days',{count:streak.longest})}</b></span></div>
    <div className="insight-heatmap" ref={calendar}>
      <div className="insight-calendar-navigation"><button aria-label={t('Insights.earlier_activity')} disabled={dayKey(start) <= earliest} onClick={() => { setOffset(value => value + 4); setSelected(null); }}><Glyph name="chevron" /></button><div className="insight-months" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} aria-hidden>{Array.from({ length: weeks }, (_, week) => { const date = addDays(start, week * 7 + 3); return <span key={week}>{week === 0 || date.getMonth() !== addDays(date, -7).getMonth() ? date.toLocaleDateString(locale(), { month: 'short' }) : ''}</span>; })}</div><button aria-label={t('Insights.more_recent_activity')} disabled={offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 4)); setSelected(null); }}><Glyph name="chevron" /></button></div>
      <div className="insight-calendar-grid"><div className="insight-weekdays" aria-hidden>{[t('Insights.sun'), t('Insights.mon'), t('Insights.tue'), t('Insights.wed'), t('Insights.thu'), t('Insights.fri'), t('Insights.sat')].map(day => <span key={day}>{day}</span>)}</div><div className="insight-heatmap-cells" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>{days.map(day => {
        const disabled = day.date > dayKey(today), level = day.words === 0 ? 0 : day.words < 250 ? 1 : day.words < 500 ? 2 : day.words < 1000 ? 3 : 4;
        return <button key={day.date} disabled={disabled} data-level={level} className={selected === day.date ? 'is-selected' : ''} title={t('Insights.words_2', { value1: fullDate(day.date), value2: number(day.words) })} aria-label={t('Insights.words_sessions', { value1: fullDate(day.date), value2: number(day.words), value3: number(day.sessions) })} onMouseEnter={() => setSelected(day.date)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(day.date)} onBlur={() => setSelected(null)} onClick={() => setSelected(day.date)} onKeyDown={event => { if (event.key === 'Escape') setSelected(null); }} />;
      })}</div></div>
    </div>
    <div className="insight-calendar-footer">{selectedDay ? <span role="status">{shortDate(selectedDay.date)} · {number(selectedDay.words)} {t('Dictionary.words')}</span> : <div className="insight-legend"><span>{t('Insights.less')}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>{t('Insights.more')}</span></div>}<Hint label={t('Insights.calendar_details')}><span>{t('Insights.all_time_dictation_activity_each_square_is_one')}</span><span>{streak.activeDays} {t('Insights.active_days_up_to_1_000_words_per')}</span><span>{t('Insights.a_streak_stays_current_until_the_end_of')}</span></Hint></div>
  </Panel>;
}
function DesktopUsage({ stats, unavailable }: { stats: Statistics; unavailable: boolean }) {
  useLocale();
  const apps = stats.applications ?? [], rows = desktopUsage(apps), tracked = apps.reduce((sum, app) => sum + app.sessions, 0);
  return <Panel className="insight-desktop-usage"><div className="insight-lower-head"><h2>{t('Insights.desktop_usage')}</h2><span className="insight-eyebrow">{t('Insights.apps_used')} <b>{unavailable || !tracked ? '—' : apps.length}</b><Hint label={t('Insights.desktop_usage_details')}><span>{t('Insights.share_of_dictations_by_application_based_on')} {number(tracked)} {t('Insights.captured_sessions')}</span><span>{t('Insights.application_tracking_starts_with_this_version_older_sessions')}</span><span>{t('Insights.browsers_are_grouped_under_other_tasks_tab_contents')}</span></Hint></span></div>
    <div className="insight-usage-rows">{rows.map(row => <div className={`insight-usage-row ${!row.sessions ? 'is-empty' : ''}`} key={row.id}><Glyph name={row.icon} /><div className="insight-usage-track" style={{ width: `${Math.max(8, row.percent)}%` }}><span><b>{unavailable || !tracked ? '—' : `${Math.round(row.percent)}%`}</b></span></div><span className="insight-usage-label"><b>{unavailable || !tracked ? '—' : number(row.sessions)}</b> {row.label}</span><Hint label={t('Insights.details', { value1: row.label })}><span>{tracked ? t('Insights.dictations_of_captured_sessions', { value1: number(row.sessions), value2: formatNumber(row.percent,{minimumFractionDigits:1,maximumFractionDigits:1}) }) : t('Insights.no_application_data_yet_new_dictations_will_appear')}</span>{row.applications.map(app => <span key={app.id}>{app.id} · {number(app.sessions)}</span>)}</Hint></div>)}</div>
  </Panel>;
}
function ActivityChart({ days, typingWpm }: { days: ActivityDay[]; typingWpm: number }) {
  useLocale();
  const [metric, setMetric] = useState<ActivityMetric>('words'), [selected, setSelected] = useState<string | null>(null);
  const { buckets, grouping } = useMemo(() => activityBuckets(days), [days, locale()]);
  const values = buckets.map(day => activityValue(day, metric, typingWpm));
  const ceiling = Math.ceil(Math.max(1, ...values) / 4) * 4;
  const format = (value: number) => metric === 'saved' ? timeLabel(value) : compactNumber(value);
  const chosenIndex = buckets.findIndex(day => day.date === selected), chosen = buckets[chosenIndex];
  const labelStep = Math.max(1, Math.ceil(buckets.length / 5));
  const caption = (bucket: ActivityBucket) => bucket.date === bucket.end ? fullDate(bucket.date) : `${shortDate(bucket.date)} – ${shortDate(bucket.end)}`;
  return <div className="insight-activity">
    <div className="insight-section-head"><h2>{t('Insights.activity')}</h2><Select variant="inline" aria-label={t('Insights.activity_metric')} value={metric} onValueChange={value => { setMetric(value as ActivityMetric); setSelected(null); }}>{(Object.keys(getMetricNames()) as ActivityMetric[]).map(value => <SelectOption key={value} value={value}>{getMetricNames()[value]}</SelectOption>)}</Select></div>
    <div className="insight-chart" aria-label={t('Insights.by_period', { value1: metric === 'saved' ? t('Insights.estimated_time_saved') : getMetricNames()[metric], value2: grouping.toLowerCase() })}>
      <div className="insight-chart-axis" aria-hidden>{[1, .5, 0].map(step => <span key={step}>{format(ceiling * step)}</span>)}</div>
      <div className="insight-chart-plot">
        <div className="insight-chart-grid" aria-hidden>{[0, 1, 2].map(i => <i key={i} />)}</div>
        <div className="insight-chart-bars" onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setSelected(null); }}>
          {buckets.map((day, i) => {
            const value = values[i], label = t('Insights.chart_point',{date:caption(day),words:t('common.count_words',{count:day.words}),sessions:t('common.count_sessions',{count:day.sessions}),time:timeLabel(day.seconds)});
            return <button className={`insight-chart-bar ${selected === day.date ? 'is-selected' : ''}`} key={day.date} aria-label={label} aria-pressed={selected === day.date} onMouseEnter={() => setSelected(day.date)} onFocus={() => setSelected(day.date)} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setSelected(null); }} onClick={() => setSelected(day.date)} onKeyDown={event => {
              if (event.key === 'Escape') setSelected(null);
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const sibling = event.key === 'ArrowRight' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling; (sibling as HTMLButtonElement | null)?.focus(); }
            }}><span data-filled={value > 0} style={{ height: value > 0 ? `${Math.max(1, value / ceiling * 100)}%` : '0%' }} />{value === 0 && <i aria-hidden className="zero-point" />}</button>;
          })}
        </div>
        {chosen && <div className="insight-chart-tip" role="status" style={{ left: `clamp(72px, ${(chosenIndex + .5) / buckets.length * 100}%, calc(100% - 72px))`, bottom: `${Math.min(80, values[chosenIndex] / ceiling * 100)}%` }}><strong>{metric === 'saved' ? timeLabel(values[chosenIndex]) : `${number(values[chosenIndex])} ${metric}`}</strong><span>{chosen.date === chosen.end ? shortDate(chosen.date) : `${shortDate(chosen.date)} – ${shortDate(chosen.end)}`}</span></div>}
        {!buckets.some(day => day.words > 0) && <div className="insight-chart-empty">{t('Insights.no_activity')}</div>}
        <div className="insight-chart-labels" aria-hidden>{buckets.filter((_, i) => i === 0 || i === buckets.length - 1 || (i % labelStep === 0 && i < buckets.length - 1 - labelStep / 2)).map(day => <span key={day.date} style={{ left: `${(buckets.indexOf(day) + .5) / buckets.length * 100}%` }}>{shortDate(day.date)}</span>)}</div>
      </div>
    </div>
  </div>;
}

export function Insights({ data, copyWithFeedback, save, onDictate }: Props & {onDictate:()=>void}) {
  useLocale();
  const [tab, setTab] = useState<'usage' | 'voice'>('usage');
  const [period, setPeriod] = useState<InsightPeriod>('all'), [retry, setRetry] = useState(0), [now, setNow] = useState(() => new Date());
  const [snapshots, setSnapshots] = useState<Partial<Record<InsightPeriod, { stats: Statistics; previous: Statistics; revision: Statistics; date: string; retry: number }>>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [explanation, setExplanation] = useState(false), [copying, setCopying] = useState(false);
  const [voice, setVoice] = useState<{ profile: VoiceReport | null; busy: boolean }>({ profile: null, busy: true });
  const voiceChanged = useCallback((profile: VoiceReport | null, busy: boolean) => setVoice({ profile, busy }), []);
  const typingWpm = data.preferences.typingWpm;
  const date = dayKey(now), snapshot = snapshots[period];
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    // All-time data is already loaded by bootstrap. Keep each other period
    // until its underlying statistics or local calendar day changes.
    if (period === 'all' || (snapshot?.revision === data.stats && snapshot.date === date && snapshot.retry === retry)) { setLoading(false); setError(''); return; }
    let active = true; const range = periodRange(period, new Date());
    setLoading(true); setError('');
    void Promise.all([call<Statistics>('statistics', { since: range.since, until: range.until }), call<Statistics>('statistics', { since: range.previousSince, until: range.previousUntil })])
      .then(([stats, previous]) => { if (active) setSnapshots(current => ({ ...current, [period]: { stats, previous, revision: data.stats, date, retry } })); })
      .catch(cause => { if (active) setError(errorSource(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, retry, data.stats, date, snapshot]);
  const unavailable = period !== 'all' && !snapshot;
  const stats = period === 'all' ? data.stats : snapshot?.stats ?? emptyStatistics, previous = snapshot?.previous ?? emptyStatistics;
  const range = periodRange(period, now), firstDay = stats.daily[0]?.date;
  const start = period === 'all' ? firstDay ? parseDay(firstDay) : range.end : range.start;
  const days = useMemo(() => fillDays(stats.daily, start, range.end), [stats.daily, start.getTime(), range.end.getTime()]);
  const saved = savedSeconds(stats.words, stats.duration, typingWpm), speed = speechWpm(stats), models = [...stats.models].sort((a, b) => b.words - a.words);
  const correctionSamples = stats.correctionSamples ?? 0, dictionarySamples = stats.dictionarySamples ?? 0;
  const fixes = (stats.wordsCorrected ?? 0) + (stats.dictionaryFixes ?? 0), ratio = speed / typingWpm;
  const gaugeDash = `${Math.min(100, Math.max(0, ratio / 4 * 100))} 100`;
  const delta = period === 'all' ? null : changePercent(stats.words, previous.words), milestone = wordMilestone(data.stats.words);
  const monthKey = dayKey(now).slice(0, 7), monthWords = data.stats.daily.filter(day => day.date.startsWith(monthKey)).reduce((sum, day) => sum + day.words, 0);
  const monthShare = data.stats.words ? Math.round(monthWords / data.stats.words * 100) : 0;
  function copySummary(event: MouseEvent<HTMLButtonElement>) {
    copyWithFeedback(event, async () => {
      setCopying(true);
      try {
        const text = tab === 'voice' && voice.profile ? voiceProfileSummary(voice.profile) : t('Insights.my_no_tipe_insights_words_dictated_sessions_estimated', { value1: getPeriodNames()[period], value2: number(stats.words), value3: number(stats.sessions), value4: timeLabel(saved), value5: typingWpm, value6: speed ? t('Insights.wpm_recent_dictation_speed', { value1: speed }) : '', value7: timeLabel(stats.duration) });
        if (native) await call('copy_text', { text }); else await navigator.clipboard.writeText(text);
      } finally { setCopying(false); }
    });
  }
  return <>
    <header className="insights-header"><NoTypeTabs id="insight" label={t('Insights.insights_views')} items={[{value:'usage',label:t('Insights.your_usage')},{value:'voice',label:t('Insights.your_voice')}]} value={tab} onChange={setTab}/><div className="insights-header-actions"><button className="insight-copy" aria-label={tab === "voice" ? t('Insights.copy_voice_profile') : t('Insights.copy_insights_summary')} title={tab === "voice" ? t('Insights.copy_voice_profile') : t('Insights.copy_insights_summary')} disabled={copying || (tab === 'voice' ? !voice.profile || voice.busy : unavailable || !stats.sessions)} onClick={copySummary}><Glyph name={tab === 'voice' ? 'share' : 'copy'} /></button>{tab === 'usage' && <Select aria-label={t('Insights.statistics_period')} value={period} onValueChange={value => setPeriod(value as InsightPeriod)}>{(Object.keys(getPeriodNames()) as InsightPeriod[]).map(value => <SelectOption value={value} key={value}>{getPeriodNames()[value]}</SelectOption>)}</Select>}</div></header>
    {tab === 'usage' && error && <div className="insight-error" role="alert"><span>{unavailable ? t('Insights.couldn_t_load_insights') : t('Insights.update_failed_showing_saved_data')}</span><button onClick={() => setRetry(v => v + 1)}>{t('common.retry')}</button></div>}
    <RetainedView active={tab === 'usage'}><div id="insight-panel-usage" role="tabpanel" aria-labelledby="insight-tab-usage" className="insight-usage-view" aria-busy={loading} hidden={tab !== 'usage'} inert={tab !== 'usage'}>
      {!unavailable&&!stats.sessions?<Empty icon="insights" title={t(data.stats.sessions?'Empty.period_title':'Empty.insights_title')} body={t(data.stats.sessions?'Empty.period_body':'Empty.insights_body')}>
        {data.stats.sessions&&period!=='all'?<button onClick={()=>setPeriod('all')}>{t('Empty.all_time')}</button>:<button className="primary" onClick={onDictate}>{t('Empty.go_dictate')}</button>}
      </Empty>:<>
      <div className="insight-overview">
        <Panel className="insight-speed-card"><strong className="insight-big-number">{unavailable || !speed ? '—' : number(speed)}</strong><div className="insight-card-label">{t('Insights.words_per_minute')}<Hint label={t('Insights.dictation_speed_details')} onClick={() => setExplanation(true)}><span>{t('Insights.up_to_100_recent_dictations_shorter_than_400')}</span><span>{number(stats.speedSamples ?? 0)} {t('Insights.qualifying_sessions_click_to_adjust_your_typing_baseline')}</span></Hint></div><div className="insight-speed-gauge"><InsightGauge dash={gaugeDash} filled={!unavailable && speed > 0} /><div><span>{t('Insights.vs_typing')}</span><strong>{unavailable || !speed ? '—' : `${formatNumber(ratio,{minimumFractionDigits:1,maximumFractionDigits:1})}×`}</strong></div></div></Panel>
        <Panel className="insight-fixes-card"><strong className="insight-big-number">{unavailable || !(correctionSamples || dictionarySamples) ? '—' : number(fixes)}</strong><div className="insight-card-label">{t('Insights.fixes_made')}<Hint label={t('Insights.fixes_details')}><span>{t('Insights.measured_ai_word_edits_plus_dictionary_replacements')}</span><span>{t('Insights.only_recorded_fixes_are_included_older_dictionary_usage')}</span></Hint></div><div className="insight-fixes-list"><div><span><b>{unavailable || !correctionSamples ? '—' : number(stats.wordsCorrected ?? 0)}</b> {t('Insights.words_corrected')}</span><Hint label={t('Insights.words_corrected_details')}><span>{t('Insights.word_additions_removals_and_replacements_by_text_processing')}</span><span>{number(correctionSamples)} {t('Insights.of')} {number(stats.sessions)} {t('Insights.sessions_have_correction_data')}</span></Hint></div><div><span><b>{unavailable || !dictionarySamples ? '—' : number(stats.dictionaryFixes ?? 0)}</b> {t('Insights.dictionary_fixes')}</span><Hint label={t('Insights.dictionary_fixes_details')}><span>{t('Insights.applied_dictionary_replacement_rules_counted_per_match')}</span><span>{number(dictionarySamples)} {t('Insights.of')} {number(stats.sessions)} {t('Insights.sessions_tracked_new_dictations_add_data_here')}</span></Hint></div></div></Panel>
        <Panel className="insight-words-card"><div className="insight-words-top"><div><strong className="insight-big-number">{unavailable ? '—' : number(stats.words)}</strong><div className="insight-card-label">{t('Insights.total_words_dictated')}<Hint label={t('Insights.words_details')}><span>{t('Insights.completed_dictations_and_imported_recordings_in_the_selected')}</span><span>{number(stats.sessions)} {t('Insights.sessions_2')} {timeLabel(stats.duration)} {t('Insights.recording')}</span></Hint></div></div>{!unavailable && period === 'all' && stats.words > 0 && <span className="insight-change" title={t('Insights.share_of_all_time_words_dictated_this_month')}>{monthShare}{t('Insights.this_month')}</span>}{!unavailable && delta !== null && <span className={`insight-change ${delta < 0 ? 'is-down' : ''}`} title={t('Insights.compared_with_the_previous_days', { value1: period })}><Glyph name="trend" />{delta > 0 ? '+' : ''}{number(delta)}%</span>}</div><div className="insight-desktop-summary"><div><span><Glyph name="desktop" />{t('Insights.desktop')}</span><strong>{unavailable ? '—' : number(stats.words)} {t('Dictionary.words')}</strong></div><button className="insight-saved-button" onClick={() => setExplanation(true)} title={t('Insights.estimated_time_saved_adjust_typing_speed')}><strong>{unavailable ? '—' : timeLabel(saved)}</strong><span>{t('Insights.time_saved')}</span></button></div></Panel>
      </div>
      <div className="insight-secondary"><DesktopUsage stats={stats} unavailable={unavailable} /><UsageCalendar daily={data.stats.daily} now={now} /></div>
      <details className="insight-more"><summary>{t('Insights.activity_models')}</summary><div><Panel className="insight-workspace">{unavailable ? <div className="insight-loading" role="status">{loading ? t('common.loading') : t('Insights.activity_unavailable')}</div> : <ActivityChart days={days} typingWpm={typingWpm} />}</Panel><div className="insight-voice-secondary"><Panel className="insight-models"><h2>{t('common.models')}</h2>{models.length ? models.map(model => <div className="insight-model" key={model.name}><strong>{model.name || t('Insights.unknown_model')}</strong><span>{number(model.words)} {t('Dictionary.words')}</span><Hint label={t('Insights.usage_details', { value1: model.name || t('Insights.unknown_model') })}><span>{number(model.sessions)} {t('Insights.sessions_2')} {timeLabel(model.seconds)} {t('Insights.recording_2')}</span></Hint></div>) : unavailable?<p className="insight-empty">{t('common.unavailable')}</p>:<Empty compact icon="models" title={t('Insights.no_dictations_yet')} body={t('Empty.models_usage_body')}/>}</Panel><Panel className="insight-milestone"><div className="insight-section-head"><h2>{t('Insights.next_milestone')}</h2><Hint label={t('Insights.milestone_details')}><span>{number(milestone.remaining)} {t('Insights.words_to_your_next_all_time_milestone')}</span></Hint></div><div className="insight-milestone-value"><strong>{compactNumber(data.stats.words)}</strong><span>/ {compactNumber(milestone.target)}</span></div><div className="insight-milestone-track"><i data-filled={milestone.progress > 0} style={{ width: `${milestone.progress * 100}%` }} /></div></Panel></div></div></details>
      </>}
    </div></RetainedView>
    <RetainedView active={tab === 'voice'}><div id="insight-panel-voice" role="tabpanel" aria-labelledby="insight-tab-voice" className="insight-voice-view" hidden={tab !== 'voice'} inert={tab !== 'voice'}><VoiceProfile revision={data.recent} snapshot={data.snapshot} onChange={voiceChanged} onDictate={onDictate} /></div></RetainedView>

    {explanation && <Modal title={t('Insights.calculations')} onClose={() => setExplanation(false)}><div className="insight-explanation"><h3>{t('Insights.time_saved')}</h3><p>{t('Insights.words_typing_speed_recording_time_minimum_zero_includes')}</p><label>{t('Insights.typing_speed')}</label><SettingInput value={typingWpm} label={t('Insights.typing_speed_for_insights')} type="number" min={10} max={250} suffix={t('Insights.wpm')} onCommit={value => save({ typingWpm: Number(value) })} /><h3>{t('Insights.dictation_speed')}</h3><p>{t('Insights.words_minutes_in_up_to_100_recent_dictations')}</p></div><footer><button onClick={() => setExplanation(false)}>{t('common.done')}</button></footer></Modal>}
  </>;
}
