// =============================================================================
// Eggie OS — _shared/today.ts 🐙☀️
// ONE source of truth for "what's happening today", imported by BOTH the
// briefing email function and the Discord /today command — so the two can
// never drift apart again. (The June 2026 bug where /today showed the legacy
// flat schedule while the app used per-week plans was exactly this disease.)
//
// The web app's own logic (slotsForDate / weekSlots in index.html) is the
// reference implementation — keep this file matching it.
// =============================================================================

export const TZ = "America/Toronto";

export function parseNotes(n: string | null | undefined): any {
  try { return n ? JSON.parse(n) : {}; } catch { return {}; }
}

/** today's date as YYYY-MM-DD in her timezone */
export function todayInTZ(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function weekdayShort(dateISO: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dateISO + "T00:00").getDay()];
}

export function mondayOf(dateISO: string): string {
  const d = new Date(dateISO + "T00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toLocaleDateString("en-CA");
}

/** this week's stream slots: per-week plan (schedWeeks[monday]) with the legacy
 *  flat `schedule` array as the CURRENT-week fallback — identical to the app */
export function weekSlots(sentinel: any, dateISO: string): any[] {
  const sw = (sentinel && sentinel.schedWeeks) || {};
  const mon = mondayOf(dateISO);
  if (sw[mon]) return sw[mon];
  if (mon === mondayOf(todayInTZ())) return (sentinel && sentinel.schedule) || [];
  return [];
}

export interface TodayBits {
  today: string;
  wd: string;
  slots: any[];          // today's stream slot(s)
  events: any[];         // calendar events touching today (incl. multi-day spans)
  dueReminders: any[];   // her own reminders: not done, due today or overdue
  openTasks: number;
  artChallenge: { text: string; done: boolean } | null;  // only when she explicitly rolled one
}

/** everything the morning surfaces show, derived from the sentinel row in one place */
export function todayBits(sentinel: any): TodayBits {
  const s = sentinel || {};
  const today = todayInTZ();
  const wd = weekdayShort(today);
  const slots = weekSlots(s, today).filter((x: any) => (x.day || "").slice(0, 3) === wd);
  const events = (s.calendarEvents || [])
    .filter((e: any) => e.date === today || (e.endDate && e.date <= today && e.endDate >= today));
  const dueReminders = (s.reminders || [])
    .filter((r: any) => !r.done && !r.toChannel && r.date <= today)
    .sort((a: any, b: any) => String(a.date + (a.time || "")).localeCompare(String(b.date + (b.time || ""))));
  const openTasks = (s.tasks || []).filter((t: any) => !t.done).length;
  // the app DERIVES a default daily challenge from the date (its prompt lists live client-side);
  // server-side we only surface one she explicitly rolled, so we never invent a different one.
  const ch = s.artChallenge || {};
  const artChallenge = (ch.dayRollDate === today && ch.dayRollText)
    ? { text: ch.dayRollText, done: ch.dayDoneDate === today }
    : null;
  return { today, wd, slots, events, dueReminders, openTasks, artChallenge };
}
