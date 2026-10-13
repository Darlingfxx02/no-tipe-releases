import {t, type MessageKey} from './i18n';
import type {VoiceReport} from './types';

const narratives:Record<string,readonly [MessageKey,MessageKey]>=Object.fromEntries(
  ['design','systems','writing','planning','quick','conversation'].map(theme=>
    [theme,[`voiceNarrative.${theme}_title`,`voiceNarrative.${theme}_description`] as [MessageKey,MessageKey]]),
);
export function voiceNarrative(profile:VoiceReport):Pick<VoiceReport,'title'|'description'> {
  // Model-written content is user data; prepared UI descriptions are localized.
  if(profile.method!=='patterns')return profile;
  const theme=Object.hasOwn(narratives,profile.theme)&&profile.theme!=='conversation'?profile.theme:
    profile.sampledSessions>0&&Math.floor(profile.sampledWords/profile.sampledSessions)<35?'quick':'conversation';
  const [title,description]=narratives[theme];
  return {title:t(title),description:t(description)};
}
