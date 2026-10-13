import {voiceNarrative} from './voiceNarrative';
import { t, useLocale, locale, formatNumber } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, errorMessage, native, errorSource } from './api';
import { InsightHint as Hint } from './InsightHint';
import { Empty, Panel } from './ui';
import { DashboardWave } from './DashboardWave';
import { useViewActive } from './RetainedView';
import type { Snapshot, Transcript, VoiceFinding, VoicePeak, VoiceProfileState, VoiceReport } from './types';
import './voice-profile.css';

const number = (value: number) => formatNumber(value);
function peakTime(peak: VoicePeak) { const date=new Date(2026,0,4+peak.weekday,peak.hour); return t('VoiceProfile.weekday_hour',{day:date.toLocaleDateString(locale(),{weekday:'long'}),time:date.toLocaleTimeString(locale(),{hour:'numeric',minute:'2-digit'})}); }
function applicationName(id: string) {
  const names: Record<string, string> = { 'com.openai.codex': 'Codex', 'com.openai.chat': 'ChatGPT', 'com.apple.Safari': 'Safari', 'com.google.Chrome': 'Chrome', 'company.thebrowser.Browser': 'Arc', 'company.thebrowser.dia': 'Dia', 'com.microsoft.VSCode': 'VS Code', 'com.todesktop.230313mzl4w4u92': 'Cursor', 'notion.id': 'Notion', 'com.tinyspeck.slackmacgap': 'Slack', 'org.telegram.desktop': 'Telegram', 'com.apple.mail': 'Mail', 'com.figma.Desktop': 'Figma' };
  return names[id] ?? id;
}
export function voiceProfileSummary(profile: VoiceReport) {
  const narrative=voiceNarrative(profile);
  const lines = [t('VoiceProfile.my_no_tipe_voice_profile', { value1: narrative.title }), narrative.description];
  if (profile.catchphrase) lines.push(t('VoiceProfile.catchphrase', { value1: profile.catchphrase.text }));
  if (profile.mostUsedWord) lines.push(t('VoiceProfile.most_used_word', { value1: profile.mostUsedWord.text }));
  if (profile.mostCorrectedWord) lines.push(t('VoiceProfile.most_corrected_word', { value1: profile.mostCorrectedWord.text, value2: profile.mostCorrectedWord.replacement }));
  if (profile.peak) lines.push(t('VoiceProfile.peak_time', { value1: peakTime(profile.peak), value2: profile.peak.application ? ` · ${applicationName(profile.peak.application)}` : '' }));
  return lines.join('\n');
}
function FindingCard({ label, finding, empty, corrected = false }: { label: string; finding: VoiceFinding | null | undefined; empty: string; corrected?: boolean }) {
  useLocale();
  return <Panel className="voice-finding"><div className="voice-finding-value">{finding ? <>{corrected ? finding.text : `“${finding.text}”`}{corrected && finding.replacement && <span className="voice-replacement">→ {finding.replacement}</span>}</> : <span className="voice-no-finding">—</span>}</div><div className="voice-label">{label}<Hint label={t('Insights.details', { value1: label })}>{finding ? <span>{number(finding.count)} {corrected ? t('VoiceProfile.substitutions') : t('VoiceProfile.occurrences')} {t('VoiceProfile.across')} {number(finding.sessions)} {t('VoiceProfile.dictations_in_this_profile')}</span> : <span>{empty}</span>}<span>{corrected ? t('VoiceProfile.repeated_word_substitutions_between_the_original_transcript_and') : label === t('VoiceProfile.catchphrase_2') ? t('VoiceProfile.a_two_to_four_word_phrase_recurring_in') : t('VoiceProfile.the_most_frequent_content_word_across_at_least')}</span></Hint></div></Panel>;
}

export function VoiceProfile({ revision, snapshot, onChange, onDictate }: { revision: readonly Transcript[]; snapshot: Snapshot; onChange: (profile: VoiceReport | null, busy: boolean) => void; onDictate:()=>void }) {
  useLocale();
  const active = useViewActive();
  const [state, setState] = useState<VoiceProfileState | null>(null), [loading, setLoading] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState('');
  const mounted = useRef(false), generation = useRef(false), request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    try { const result = await call<VoiceProfileState>('voice_profile'); if (mounted.current && sequence === request.current && !generation.current) { setState(result); setError(''); } }
    catch (cause) { if (mounted.current && sequence === request.current && !generation.current) setError(errorSource(cause)); }
    finally { if (mounted.current && sequence === request.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);
  useEffect(() => { void load(); }, [load, revision]);
  useEffect(() => {
    if (!native) return;
    let active = true, unlisten: (() => void) | undefined;
    void listen('voice-profile-changed', () => { if (active) void load(); }).then(stop => { if (active) unlisten = stop; else stop(); }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, [load]);
  useEffect(() => { if (!state?.building) return; const timer = setInterval(() => { void load(); }, 2000); return () => clearInterval(timer); }, [state?.building, load]);
  const profile = state?.profile ?? null, busy = working || !!state?.building;
  useEffect(() => { onChange(profile, busy || loading); }, [profile, busy, loading, onChange]);
  async function generate() {
    if (generation.current || busy || !state?.canGenerate) return;
    generation.current = true; ++request.current; setWorking(true); setError('');
    try { const result = await call<VoiceProfileState>('generate_voice_profile'); if (mounted.current) setState(result); }
    catch (cause) { if (mounted.current) setError(errorSource(cause)); }
    finally { generation.current = false; if (mounted.current) setWorking(false); }
  }
  const ready = !!state?.canGenerate;
  const progressText = loading && !state ? t('common.loading') : busy ? t('VoiceProfile.building_your_profile') : !state ? t('VoiceProfile.profile_unavailable') : ready && !state.canRefine ? profile ? t('VoiceProfile.ready_to_update') : t('VoiceProfile.ready_to_create') : t('VoiceProfile.more_words', { value1: profile ? t('VoiceProfile.next_update_in') : t('VoiceProfile.ready_in'), count: state.remainingWords });
  const action = busy ? t('VoiceProfile.building') : profile ? state?.canRefine && state.remainingWords > 0 ? t('VoiceProfile.retry_description') : t('VoiceProfile.update_profile') : t('VoiceProfile.create_profile');
  const peak = profile?.peak;
  return <div className="voice-profile" aria-busy={busy || loading}>
    <div className="voice-progress"><div className={`voice-progress-track ${busy ? 'is-building' : ''}`} role="progressbar" aria-label={profile ? t('VoiceProfile.progress_to_the_next_voice_profile') : t('VoiceProfile.progress_to_your_first_voice_profile')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state?.progress ?? 0) * 100)}><i data-filled={busy || (state?.progress ?? 0) > 0} style={{ width: `${(state?.progress ?? 0) * 100}%` }} /></div><div className="voice-progress-caption"><span>{profile ? t('VoiceProfile.created', { value1: new Date(profile.createdAt * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('VoiceProfile.your_voice_profile')}</span><div><span role="status">{progressText}</span><Hint label={t('VoiceProfile.voice_profile_updates')}><span>{t('VoiceProfile.your_first_profile_needs_2_000_dictated_words')}</span><span>{number(state?.storedWords ?? 0)} {t('VoiceProfile.words_retained_locally_deleting_source_history_clears_the')}</span><span>{t('VoiceProfile.analysis_stays_on_this_device_a_configured_on')}</span></Hint>{profile&&(ready || busy) && <button className="voice-create" disabled={!ready || busy} onClick={() => { void generate(); }}>{action}</button>}</div></div></div>
    {error && <div className="insight-error" role="alert"><span>{profile ? t('VoiceProfile.couldn_t_update_your_profile') : t('VoiceProfile.couldn_t_create_your_profile')}<Hint label={t('VoiceProfile.voice_profile_error')}><span>{errorMessage(error)}</span></Hint></span><button onClick={() => { if (state?.canGenerate) void generate(); else void load(); }}>{t('common.retry')}</button></div>}
    {!profile&&!state&&<div className="insight-loading" role="status">{t(loading?'common.loading':'VoiceProfile.profile_unavailable')}</div>}
    {!profile&&state&&<Empty icon="audio" title={busy?t('VoiceProfile.finding_your_voice'):ready?t('VoiceProfile.ready_to_create'):t('VoiceProfile.your_voice_is_taking_shape')} body={t(busy?'VoiceProfile.looking_for_recurring_phrases_words_and_themes_in':ready?'Empty.voice_ready_body':'Empty.voice_body')}>
      {state&&!busy&&!loading&&(ready?<button className="primary" onClick={()=>void generate()}>{t('VoiceProfile.create_profile')}</button>:<button className="primary" onClick={onDictate}>{t('Empty.go_dictate')}</button>)}
    </Empty>}
    {profile&&<>
    <Panel className="voice-hero"><div className="voice-hero-wave" aria-hidden><DashboardWave snapshot={snapshot} visible={active} edgeReach={48} bottomEdge /></div><div className="voice-hero-copy"><h2>{(profile ? voiceNarrative(profile).title : null) ?? (busy ? t('VoiceProfile.finding_your_voice') : t('VoiceProfile.your_voice_is_taking_shape'))}</h2><div className="voice-label">{t('VoiceProfile.voice_profile')}<Hint label={t('VoiceProfile.voice_profile_details')}>{profile ? <><span>{t('VoiceProfile.based_on')} {number(profile.sampledWords)} {t('VoiceProfile.recent_words_across')} {number(profile.sampledSessions)} {t('VoiceProfile.saved_dictations')}</span><span>{profile.method === 'localModel' ? t('VoiceProfile.description_by_your_local_model', { value1: profile.model }) : profile.model ? t('VoiceProfile.prepared_description_selected_from_text_patterns_your_local', { value1: profile.model }) : t('VoiceProfile.one_of_six_prepared_descriptions_selected_from_recurring')}</span></> : <span>{t('VoiceProfile.save_at_least_2_000_dictated_words_in')}</span>}<span>{t('VoiceProfile.this_uses_the_text_of_saved_dictations_the')}</span></Hint></div><p>{(profile ? voiceNarrative(profile).description : null) ?? (busy ? t('VoiceProfile.looking_for_recurring_phrases_words_and_themes_in') : t('VoiceProfile.keep_dictating_to_discover_your_recurring_words_phrases'))}</p></div></Panel>
    <div className="voice-details"><div className="voice-findings"><FindingCard label={t('VoiceProfile.catchphrase_2')} finding={profile?.catchphrase} empty={t('VoiceProfile.no_phrase_recurs_across_enough_dictations_yet')} /><FindingCard label={t('VoiceProfile.most_used_word_2')} finding={profile?.mostUsedWord} empty={t('VoiceProfile.not_enough_recurring_words_in_the_saved_dictations')} /><FindingCard label={t('VoiceProfile.most_corrected_word_2')} finding={profile?.mostCorrectedWord} corrected empty={t('VoiceProfile.no_repeated_word_substitutions_found_in_your_ai')} /></div><Panel className="voice-peak"><div className="voice-peak-icon" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18Z" /></svg></div><h2>{peak ? peakTime(peak) : '—'}</h2><div className="voice-label">{t('VoiceProfile.your_peak_time_app')}<Hint label={t('VoiceProfile.peak_time_details')}><span>{peak ? t('VoiceProfile.dictations_words_in_this_weekday_and_hour', { value1: number(peak.sessions), value2: number(peak.words) }) : t('VoiceProfile.your_busiest_weekday_and_hour_will_appear_after')}</span><span>{t('VoiceProfile.based_on_all_time_dictation_counts_in_your')}</span></Hint></div><p>{peak ? t('VoiceProfile.is_when_you_dictate_most_often', { value1: peakTime(peak), value2: peak.application ? t('VoiceProfile.is_your_most_used_app_during_that_hour', { value1: applicationName(peak.application) }) : '' }) : t('VoiceProfile.your_busiest_hour_and_the_app_where_your')}</p></Panel></div>
    </>}
  </div>;
}
