import {
  CalendarDays,
  CheckCircle2,
  Clock,
  HelpCircle,
  MapPin,
  Moon,
  User,
  XCircle,
} from "lucide-react";

import { formatDate, formatRange, formatTime } from "./format.js";

/* ============================================================
   TIMETABLE

   Informational only. This card never shows a booking action,
   whatever the reply contains — "when is this class?" is not a
   request to meet anyone.
============================================================ */

const KIND_LABEL = { lab: "Lab", activity: "Activity" };

export function TimetableCard({ message }) {
  const entries = message.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="card timetable">
        <CardHead
          icon={<CalendarDays size={15} strokeWidth={2} />}
          title={headingFor(message)}
        />
        <p className="card-empty">Nothing scheduled.</p>
      </div>
    );
  }

  // Group by day so a whole-week reply reads as a week rather than a
  // flat list of forty rows.
  const days = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }

  return (
    <div className="card timetable">
      <CardHead
        icon={<CalendarDays size={15} strokeWidth={2} />}
        title={headingFor(message)}
        meta={sectionLine(message.section)}
      />

      {days.map((group) => (
        <div className="tt-day" key={group.day}>
          {days.length > 1 && <h4 className="tt-day-name">{group.day}</h4>}

          <ul className="tt-rows">
            {group.entries.map((entry, index) => (
              <li className="tt-row" key={`${entry.start}-${index}`}>
                <span className="tt-time">
                  {formatRange(entry.start, entry.end)}
                </span>

                <div className="tt-body">
                  {entry.kind !== "lecture" && (
                    <span className={`tt-kind ${entry.kind}`}>
                      {KIND_LABEL[entry.kind] ?? entry.kind}
                    </span>
                  )}

                  {entry.activity && (
                    <strong className="tt-title">{entry.activity}</strong>
                  )}

                  {/* An elective slot carries several courses. Each gets
                      its own line — students attend different ones, so
                      collapsing them would hide the one that matters. */}
                  {(entry.courses ?? []).map((course) => (
                    <div className="tt-course" key={course.code}>
                      <strong className="tt-title">{course.title}</strong>
                      <span className="tt-code">{course.code}</span>
                      <span className="tt-meta">
                        {course.faculty?.length > 0 && (
                          <span>
                            <User size={12} strokeWidth={2} />
                            {course.faculty.join(", ")}
                          </span>
                        )}
                        {course.rooms?.length > 0 && (
                          <span>
                            <MapPin size={12} strokeWidth={2} />
                            {course.rooms.join(", ")}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}

                  {entry.note && <p className="tt-note">{entry.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function headingFor(message) {
  const day = message.day === "whole week" ? "This week" : message.day;
  return message.faculty ? `${day} — ${message.faculty}` : day;
}

function sectionLine(section) {
  if (!section) return null;
  const bits = [];
  if (section.program) bits.push(section.program);
  if (section.semester) bits.push(`semester ${section.semester}`);
  if (section.default_room) bits.push(`room ${section.default_room}`);
  return bits.join(" · ");
}

/* ============================================================
   AVAILABILITY

   The backend decides bookability. This card only ever surfaces a
   Book action when `bookable` is true, or against an entry in
   `alternatives` — it never infers one from the status.
============================================================ */

const STATUS = {
  free: { label: "Free", icon: CheckCircle2 },
  busy: { label: "Busy", icon: XCircle },
  maybe: { label: "Possibly free", icon: HelpCircle },
  break: { label: "Break", icon: Clock },
  outside_hours: { label: "Outside hours", icon: Moon },
};

export function AvailabilityCard({ message, onBook }) {
  const status = STATUS[message.status] ?? {
    label: message.status,
    icon: HelpCircle,
  };
  const Icon = status.icon;

  return (
    <div className="card availability">
      <div className="av-head">
        <div>
          <h4 className="av-faculty">{message.faculty}</h4>
          <p className="av-when">
            {formatDate(message.date)} at {formatTime(message.time)}
            {message.duration_min ? ` · ${message.duration_min} min` : ""}
          </p>
        </div>

        {/* The word carries the meaning; colour only reinforces it. */}
        <span className={`av-badge ${message.status}`}>
          <Icon size={14} strokeWidth={2.2} />
          {status.label}
        </span>
      </div>

      {message.reason && <p className="av-reason">{message.reason}</p>}

      {message.status === "maybe" && (
        <p className="av-caveat">
          They might be busy then. The faculty member will confirm when they
          respond.
        </p>
      )}

      {message.bookable && (
        <button
          className="av-book"
          onClick={() =>
            onBook({
              faculty_id: message.faculty_id,
              faculty: message.faculty,
              date: message.date,
              time: message.time,
              duration_min: message.duration_min ?? 15,
            })
          }
        >
          Book appointment
        </button>
      )}

      {(message.alternatives ?? []).length > 0 && (
        <div className="av-alts">
          <span className="av-alts-label">
            {message.bookable ? "Also free" : "Free instead"}
          </span>

          <div className="av-chips">
            {message.alternatives.map((slot) => (
              <span className="av-chip" key={`${slot.start}-${slot.end}`}>
                {formatRange(slot.start, slot.end)}
                <button
                  onClick={() =>
                    onBook({
                      faculty_id: message.faculty_id,
                      faculty: message.faculty,
                      // Alternatives are same-day by contract: only the
                      // start time changes.
                      date: message.date,
                      time: slot.start,
                      duration_min: message.duration_min ?? 15,
                    })
                  }
                  aria-label={`Book ${message.faculty} at ${formatTime(slot.start)}`}
                >
                  Book
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- shared ---------- */

function CardHead({ icon, title, meta }) {
  return (
    <div className="card-head">
      <span className="card-icon">{icon}</span>
      <div>
        <h4>{title}</h4>
        {meta && <p>{meta}</p>}
      </div>
    </div>
  );
}