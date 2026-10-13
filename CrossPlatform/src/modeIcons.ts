import { t } from './i18n';
export const getModeIcons = () => ([
  {id:'iconsax:magicpen', asset:'magicpen', label:t('modeIcons.writing')},
  {id:'iconsax:document-text', asset:'document-text', label:t('modeIcons.notes')},
  {id:'iconsax:message-text', asset:'message-text', label:t('modeIcons.messages')},
  {id:'iconsax:translate', asset:'translate', label:t('Modes.translation')},
  {id:'iconsax:microphone', asset:'microphone', label:t('Models.dictation')},
  {id:'iconsax:code', asset:'code', label:t('modeIcons.code')},
  {id:'iconsax:briefcase', asset:'briefcase', label:t('modeIcons.work')},
  {id:'iconsax:lamp-charge', asset:'lamp-charge', label:t('modeIcons.ideas')},
] as const);

export const defaultModeIcon = getModeIcons()[0].id;

// Keep existing modes recognizable without rewriting their saved settings.
const legacyIcons: Record<string, string> = {
  '✦':'iconsax:magicpen',
  '◈':'iconsax:document-text',
  '✉':'iconsax:message-text',
  '↗':'iconsax:translate',
  '◌':'iconsax:microphone',
};

export function resolveModeIcon(value: string) {
  const id = legacyIcons[value] ?? value;
  return getModeIcons().find(icon=>icon.id===id) ?? getModeIcons()[0];
}
