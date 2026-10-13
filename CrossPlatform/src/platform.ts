// Bootstrap supplies the authoritative OS. Detect it before that response so
// Windows never starts with macOS window spacing or shortcut symbols.
export function detectPlatform(info:Pick<Navigator,'platform'|'userAgent'>|undefined):string {
  if(!info)return 'preview';
  const identity=`${info.platform} ${info.userAgent}`;
  if(/Win/i.test(identity))return 'windows';
  if(/Mac/i.test(identity))return 'macos';
  if(/Linux/i.test(identity))return 'linux';
  return 'preview';
}
