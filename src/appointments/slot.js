/**
 * Formatting for appointment times.
 *
 * Every time in this feature is a wall-clock time in IST that arrives
 * carrying its own offset, e.g. "2026-10-06T14:00:00+05:30". Passing one
 * through Date and reading it back with getHours() re-expresses it in
 * whatever zone the viewer's machine is set to: a laptop still on UTC would
 * render a 14:00 appointment as 08:30, confidently and wrongly.
 *
 * So the parts are read off the string and printed as written. Date is used
 * in exactly two places, both with UTC-only arithmetic where nothing can
 * drift: working out a weekday, and working out today's date in IST.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday",
                   "Thursday", "Friday", "Saturday"];

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** "2026-10-06T14:00:00+05:30" -> {year, month, day, hour, minute}, or null. */
export function parts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(iso ?? ""));
  if (!match) return null;
  return {
    year: +match[1],
    month: +match[2],
    day: +match[3],
    hour: match[4] === undefined ? null : +match[4],
    minute: match[5] === undefined ? null : +match[5],
  };
}

/** 14:00 -> "2:00 pm" */
export function clockOf(p) {
  if (!p || p.hour === null) return "";
  const suffix = p.hour < 12 ? "am" : "pm";
  const hour = p.hour % 12 || 12;
  return `${hour}:${String(p.minute ?? 0).padStart(2, "0")} ${suffix}`;
}

/** -> "Tue, 6 Oct" */
export function dayOf(p) {
  if (!p) return "";
  const weekday = DAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday}, ${p.day} ${MONTHS[p.month - 1]}`;
}

/** -> "Tuesday, 6 October 2026" */
export function dayOfLong(p) {
  if (!p) return "";
  const weekday = DAYS_LONG[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday}, ${p.day} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** -> "Tue, 6 Oct · 2:00 pm – 2:15 pm" */
export function formatSlot(start, end) {
  const from = parts(start);
  if (!from) return "";
  const to = parts(end);
  const when = from.hour === null ? dayOf(from) : `${dayOf(from)} · ${clockOf(from)}`;
  return to && to.hour !== null ? `${when} – ${clockOf(to)}` : when;
}

/** -> "Tuesday, 6 October 2026 at 2:00 pm" */
export function formatSlotLong(start) {
  const p = parts(start);
  if (!p) return "";
  return p.hour === null ? dayOfLong(p) : `${dayOfLong(p)} at ${clockOf(p)}`;
}

/** "15:40" -> "3:40 pm" */
export function formatClock(hhmm) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ""));
  if (!match) return String(hhmm ?? "");
  return clockOf({ hour: +match[1], minute: +match[2] });
}

/** Add minutes to "14:00", staying inside the day. -> "14:15" */
export function addMinutes(hhmm, minutes) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ""));
  if (!match) return "";
  const total = (+match[1] * 60 + +match[2] + (minutes || 0)) % (24 * 60);
  const wrapped = (total + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * Today's date in IST as "YYYY-MM-DD", whatever zone the viewer is in.
 * Shifting the instant and then reading UTC parts gives the IST calendar
 * day without touching local-time methods.
 */
export function todayInIST() {
  const shifted = new Date(Date.now() + IST_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
