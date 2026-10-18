/**
 * Shared formatting. Every time in this feature is IST and shown in
 * 12-hour form; every date reads "Mon, 5 Oct".
 *
 * The backend sends wall-clock strings ("10:00", "2026-10-05") for slots
 * and full ISO with offset for appointment times. Wall-clock values are
 * deliberately NOT put through the Date constructor with a timezone —
 * "10:00 on Monday" means 10:00 on campus regardless of where the
 * browser thinks it is.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "10:00" -> "10:00 am", "14:30" -> "2:30 pm" */
export function formatTime(value) {
  if (!value) return "";
  const [h, m] = String(value).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(value);

  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "10:00", "12:40" -> "10:00 am to 12:40 pm" */
export function formatRange(start, end) {
  if (!start) return "";
  return end ? `${formatTime(start)} to ${formatTime(end)}` : formatTime(start);
}

/** "2026-10-05" -> "Mon, 5 Oct" */
export function formatDate(value) {
  if (!value) return "";
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return String(value);

  // Midday avoids any chance of a DST or rounding slip landing on the
  // previous day when the runtime resolves the date.
  const date = new Date(y, m - 1, d, 12);
  return `${DAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

/** Full ISO with offset -> "Mon, 5 Oct at 11:00 am" */
export function formatSlot(iso) {
  if (!iso) return "";
  const [datePart, rest] = String(iso).split("T");
  if (!rest) return formatDate(datePart);
  return `${formatDate(datePart)} at ${formatTime(rest.slice(0, 5))}`;
}
