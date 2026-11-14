import type { CSSProperties } from 'react';

const paths = {
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z',
  file: 'M13 3H5v18h14V9l-6-6ZM13 3v6h6M8 14h8M8 17h5',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z',
  save: 'M4 3h13l4 4v14H3V3h1ZM7 3v6h9V3M7 21v-8h10v8',
  play: 'm9 5 11 7-11 7V5Z',
  stop: 'M6 6h12v12H6z',
  record: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  terminal: 'm4 6 6 6-6 6m9 0h7',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm5.5 13 5 5',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  cursor: 'm5 3 15 9-7 2-3 7L5 3Z',
  browser: 'M3 4h18v16H3V4Zm0 5h18M7 6.5h.01m3 0h.01',
  text: 'M4 5h16M12 5v15M8 20h8',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  branch: 'M6 3v12a4 4 0 0 0 4 4h7m-4-4 4 4-4 4M6 7h11m-4-4 4 4-4 4',
  repeat: 'M4 7h14l-3-3m5 13H6l3 3M20 7v5M4 17v-5',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  data: 'M3 5h18v14H3V5Zm0 5h18M9 5v14',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  code: 'm8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18',
  box: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v9M7 5.8l9 5',
  arrowDown: 'M12 3v18m-6-6 6 6 6-6',
  arrowRight: 'M3 12h18m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 4v16M4 12h16',
  star: 'm12 3 2.8 5.7L21 10l-4.5 4.4 1.1 6.2L12 17.7l-5.6 2.9 1.1-6.2L3 10l6.2-1.3L12 3Z',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg className="studio-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}

export function ActivityGlyph({ activityId }: { activityId: string }) {
  const id = activityId.toLowerCase();
  const name: IconName = /throw|error|exception/.test(id) ? 'alert' : /try|catch|assert|verify|transaction-scope/.test(id) ? 'shield'
    : /browser|navigate|url/.test(id) ? 'browser' : /click|hover|mouse|element/.test(id) ? 'cursor'
    : /type|text|write-line/.test(id) ? 'text' : /delay|wait/.test(id) ? 'clock' : /log/.test(id) ? 'terminal'
    : /if|switch|decision/.test(id) ? 'branch' : /loop|each|while|retry/.test(id) ? 'repeat'
    : /mail|outlook/.test(id) ? 'mail' : /script|code/.test(id) ? 'code' : /csv|excel|table|collection|list/.test(id) ? 'data'
    : /file|document|pdf/.test(id) ? 'file' : /folder/.test(id) ? 'folder' : /sequence/.test(id) ? 'layers' : 'box';
  return <Icon name={name} />;
}

export function RunwayMark() {
  return <svg className="runway-mark" width="30" height="36" viewBox="0 0 30 36" fill="none" aria-hidden="true"><defs><linearGradient id="studio-brand" x1="2" y1="0" x2="28" y2="36" gradientUnits="userSpaceOnUse"><stop stopColor="#9855ff"/><stop offset=".55" stopColor="#6973ff"/><stop offset="1" stopColor="#38bdf8"/></linearGradient></defs><path d="M4 5h13c10 0 11 9 3 15L12 27v5m5-7 9 6" stroke="url(#studio-brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
