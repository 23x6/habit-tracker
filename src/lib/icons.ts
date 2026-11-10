// Thin stroke icons on a 24×24 grid. Habit icons are user-selectable; UI icons are used by the interface.

export const HABIT_ICONS: Record<string, string> = {
  circle: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z',
  drop: 'M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z',
  book: 'M4 5.5c2.5-1 5-1 8 1v13c-3-2-5.5-2-8-1zM20 5.5c-2.5-1-5-1-8 1v13c3-2 5.5-2 8-1z',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 2v4M8 12l2-4h4l2 4M12 8l-1 7',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  leaf: 'M5 19c0-8 5-13 14-14c0 9-5 14-13 14zM5 19l7-7',
  pen: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  heart: 'M12 19s-7-4.3-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7 2.5C19 14.7 12 19 12 19z',
  cup: 'M5 8h11v6a5 5 0 0 1-10 0zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M11 3.5v2',
  dumbbell: 'M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0z',
  bed: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0 .01',
  breath: 'M4 9h10a3 3 0 1 0-3-3M4 13h14a3 3 0 1 1-3 3M4 17h6',
  apple: 'M12 7.5c-2-1.5-6-1-6 4c0 4 2.5 8 4.5 8c.8 0 1-.5 1.5-.5s.7.5 1.5.5c2 0 4.5-4 4.5-8c0-5-4-5.5-6-4zM12 7.5c0-2 1-3.5 3-4',
  trend: 'M4 17l5-5l4 4l7-7M15 9h5v5',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
};

export const ICON_NAMES = Object.keys(HABIT_ICONS);

export const UI_ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7l7 7',
  right: 'M9 5l7 7l-7 7',
  grip: 'M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  edit: 'M4 20l1-4L16 5l3 3L8 19z',
  today: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  note: 'M6 4h12v16H6zM9 9h6M9 13h6M9 17h3',
  info: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 11v5M12 8h.01',
  sort: 'M8 5v14M5 8l3-3l3 3M16 19V5M13 16l3 3l3-3',
  journal: 'M7 4h11v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 17a2 2 0 0 1 2-2h11M9 8h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;

export type UIIcon = keyof typeof UI_ICONS;
