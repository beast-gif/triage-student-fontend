/**
 * The ids of appointments this browser has created.
 *
 * There is no login, so this list is how the desk knows which requests to
 * ask about. It holds ids and nothing else: the backend owns every detail,
 * including what the student is allowed to do with each one. Caching
 * statuses here would only create a second version of the truth that goes
 * stale the moment a faculty member replies.
 *
 * Every access is wrapped: localStorage throws in private mode, when site
 * data is blocked, and when a stale value turns out not to be JSON. None of
 * that is worth breaking the desk over.
 */

const KEY = "desk_appointment_ids";
const MAX = 50;

/** Newest first. Returns [] rather than throwing, whatever is in there. */
export function readAppointmentIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const ids = [];
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const id = value.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= MAX) break;
    }
    return ids;
  } catch {
    return [];
  }
}

/** Adds an id at the front. Moves it there if it is already known. */
export function rememberAppointmentId(id) {
  if (typeof id !== "string" || !id.trim()) return readAppointmentIds();
  const next = [id.trim(), ...readAppointmentIds().filter((k) => k !== id.trim())]
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The list is a convenience, not the record. The appointment exists on
    // the server either way, and the student still has the email.
  }
  return next;
}

export function forgetAppointmentId(id) {
  const next = readAppointmentIds().filter((k) => k !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do.
  }
  return next;
}

export function clearAppointmentIds() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  return [];
}

export const APPOINTMENT_IDS_KEY = KEY;
