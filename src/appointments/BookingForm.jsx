import { useEffect, useRef, useState } from "react";
import { CalendarClock, Loader2, Pencil } from "lucide-react";

import { createAppointment, ApiError } from "./api.js";
import {
  ALLOWED_EMAIL_DOMAIN,
  DURATIONS,
  PURPOSE_MAX,
  ROLL_PATTERN,
  STUDENT_STORAGE_KEY,
} from "./config.js";
import { formatDate, formatTime } from "./format.js";
import { addMinutes, todayInIST } from "./slot.js";
import { rememberAppointmentId } from "./appointmentIds.js";
import "./booking-when.css";

/**
 * The booking form, inside the thread.
 *
 * Submitting creates a DRAFT. No email leaves the building until the
 * student reads the preview and confirms — which is the whole point of
 * the two-step flow, so it is worth saying so on the button itself.
 *
 * The time is editable. It arrives from whichever slot the student
 * clicked Book on, which is right nearly always — but the backend can
 * still answer 409 because someone booked that slot in the meantime, and
 * "pick another time" is not an instruction you can follow on a form with
 * no time field. So the slot shows as a line with a Change button, and a
 * 409 opens that picker itself rather than leaving the student to work
 * out that Cancel and start again is the only way forward.
 */

const EMPTY = {
  name: "",
  roll_no: "",
  branch: "",
  semester: "",
  section: "",
  email: "",
  purpose: "",
  duration_min: 15,
};

/** Their own details persist; the purpose is different every time. */
const REMEMBERED = ["name", "roll_no", "branch", "semester", "section", "email"];

function loadRemembered() {
  try {
    const saved = JSON.parse(localStorage.getItem(STUDENT_STORAGE_KEY) ?? "{}");
    const picked = {};
    for (const key of REMEMBERED) {
      if (typeof saved[key] === "string" || typeof saved[key] === "number") {
        picked[key] = saved[key];
      }
    }
    return picked;
  } catch {
    // Private mode, cleared storage, or a stale value that isn't JSON.
    return {};
  }
}

function remember(form) {
  try {
    const picked = {};
    for (const key of REMEMBERED) picked[key] = form[key];
    localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(picked));
  } catch {
    // Not worth surfacing: the request itself succeeded.
  }
}

function forget() {
  try {
    localStorage.removeItem(STUDENT_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Other free windows that day, if whatever opened this form passed them
 * along. Shapes differ by source, so read defensively and show nothing
 * rather than guessing.
 */
function windowsFor(slot) {
  const list = slot?.alternatives ?? slot?.free_slots ?? [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item.start === "string")
    .map((item) => ({
      date: typeof item.date === "string" ? item.date : slot.date,
      start: item.start,
      end: typeof item.end === "string" ? item.end : null,
    }));
}

/** One rule per field, so blur and submit can't disagree. */
function validateField(name, value) {
  const text = String(value ?? "").trim();

  switch (name) {
    case "name":
      return text ? null : "Enter your full name.";

    case "roll_no":
      if (!text) return "Enter your roll number.";
      return ROLL_PATTERN.test(text)
        ? null
        : "That doesn't look right — e.g. BL.EN.U4EAC23051";

    case "branch":
      return text ? null : "Enter your branch.";

    case "semester":
      return text ? null : "Select your semester.";

    case "email":
      if (!text) return "Enter your college email.";
      if (!/^[^\s@]+@[^\s@]+$/.test(text)) return "Enter a valid email address.";
      return text.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
        ? null
        : `Use your college email, ending in @${ALLOWED_EMAIL_DOMAIN}`;

    case "purpose":
      if (!text) return "Say briefly what the meeting is about.";
      return text.length > PURPOSE_MAX
        ? `Keep it under ${PURPOSE_MAX} characters.`
        : null;

    case "date":
      if (!text) return "Pick a date.";
      // The picker's min attribute stops this in the UI; a typed or
      // pasted value can still get past it.
      return text < todayInIST() ? "That date has already passed." : null;

    case "time":
      return text ? null : "Pick a start time.";

    default:
      return null;
  }
}

export default function BookingForm({ slot, onCreated, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...loadRemembered(),
    duration_min: slot.duration_min ?? 15,
    date: slot.date ?? "",
    time: slot.time ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [prefilled, setPrefilled] = useState(false);
  const [editingWhen, setEditingWhen] = useState(!slot.date || !slot.time);

  const timeRef = useRef(null);
  const openedByClash = useRef(false);

  useEffect(() => {
    setPrefilled(Boolean(loadRemembered().name));
  }, []);

  // A clash opens the picker; the cursor belongs on the field that has to
  // change, not back at the top of the form.
  useEffect(() => {
    if (openedByClash.current && editingWhen && timeRef.current) {
      timeRef.current.focus();
      openedByClash.current = false;
    }
  }, [editingWhen]);

  function set(name) {
    return (event) => {
      // Roll numbers are stored and displayed upper-case, so the field
      // shows what will actually be sent.
      const raw = event.target.value;
      const value = name === "roll_no" ? raw.toUpperCase() : raw;

      setForm((prev) => ({ ...prev, [name]: value }));

      // Clear an error as soon as the field becomes valid — leaving it
      // there while someone fixes it reads as "still wrong".
      if (errors[name]) {
        setErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
      }

      // Changing the slot is the student acting on the clash, so the
      // backend's complaint about the old time stops applying.
      if (name === "date" || name === "time" || name === "duration_min") {
        setFailure(null);
      }
    };
  }

  function blur(name) {
    return () => {
      setTouched((prev) => ({ ...prev, [name]: true }));
      setErrors((prev) => ({ ...prev, [name]: validateField(name, form[name]) }));
    };
  }

  function pickWindow(window) {
    setForm((prev) => ({ ...prev, date: window.date, time: window.start }));
    setErrors((prev) => ({ ...prev, date: null, time: null }));
    setFailure(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    const found = {};
    for (const name of [
      "name", "roll_no", "branch", "semester", "email", "purpose", "date", "time",
    ]) {
      const problem = validateField(name, form[name]);
      if (problem) found[name] = problem;
    }

    setErrors(found);
    setTouched(
      Object.fromEntries(Object.keys(found).map((key) => [key, true]))
    );

    if (Object.keys(found).length > 0) {
      // A date or time error is invisible while the picker is shut.
      if (found.date || found.time) {
        openedByClash.current = true;
        setEditingWhen(true);
        return;
      }
      // Put the cursor where the work is.
      document
        .querySelector(`[name="${Object.keys(found)[0]}"]`)
        ?.focus();
      return;
    }

    setBusy(true);
    setFailure(null);

    try {
      const draft = await createAppointment({
        faculty_id: slot.faculty_id,
        date: form.date,
        time: form.time,
        duration_min: Number(form.duration_min),
        student: {
          name: form.name.trim(),
          roll_no: form.roll_no.trim().toUpperCase(),
          branch: form.branch.trim(),
          semester: Number(form.semester),
          section: form.section.trim(),
          email: form.email.trim(),
        },
        purpose: form.purpose.trim(),
      });

      remember(form);
      // Recorded on create, not on confirm: a draft the student abandons is
      // still theirs, still cancellable, and otherwise invisible to them.
      rememberAppointmentId(draft?.appointment_id);
      onCreated(draft);
    } catch (err) {
      setFailure(
        err instanceof ApiError ? err.message : "Could not create the request."
      );
      // 409 is the backend saying "that time is taken" — the one error the
      // student can actually fix here, so open the thing that fixes it.
      if (err?.status === 409) {
        openedByClash.current = true;
        setEditingWhen(true);
      }
    } finally {
      setBusy(false);
    }
  }

  const left = PURPOSE_MAX - form.purpose.length;
  const windows = windowsFor(slot);
  const endsAt = form.time ? addMinutes(form.time, Number(form.duration_min)) : "";
  const whenError = (touched.date && errors.date) || (touched.time && errors.time);

  return (
    <form className="card booking" onSubmit={submit} noValidate>
      <div className="card-head">
        <span className="card-icon">
          <CalendarClock size={15} strokeWidth={2} />
        </span>
        <div>
          <h4>Request an appointment</h4>
          <p>{slot.faculty}</p>
        </div>
      </div>

      {/* The slot, and the way out of a clash. */}
      <div className={`bf-when ${editingWhen ? "is-open" : ""}`}>
        <div className="bf-when-head">
          <div className="bf-when-text">
            <span className="bf-when-label">When</span>
            <strong>
              {form.date ? formatDate(form.date) : "No date picked"}
              {form.time && ` · ${formatTime(form.time)}`}
              {form.time && endsAt && ` – ${formatTime(endsAt)}`}
            </strong>
          </div>
          <button
            type="button"
            className="bf-when-toggle"
            onClick={() => setEditingWhen((open) => !open)}
            aria-expanded={editingWhen}
          >
            <Pencil size={13} strokeWidth={2} />
            {editingWhen ? "Done" : "Change"}
          </button>
        </div>

        {editingWhen && (
          <div className="bf-when-body">
            {windows.length > 0 && (
              <>
                <p className="bf-when-sub">Free that day</p>
                <div className="bf-when-chips">
                  {windows.map((window, index) => {
                    const on = form.date === window.date && form.time === window.start;
                    return (
                      <button
                        key={`${window.date}-${window.start}-${index}`}
                        type="button"
                        className={`bf-when-chip ${on ? "is-on" : ""}`}
                        onClick={() => pickWindow(window)}
                        aria-pressed={on}
                      >
                        {formatTime(window.start)}
                        {window.end ? ` – ${formatTime(window.end)}` : ""}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="bf-when-fields">
              <Field
                label="Date"
                name="date"
                type="date"
                value={form.date}
                min={todayInIST()}
                onChange={set("date")}
                onBlur={blur("date")}
                error={touched.date && errors.date}
              />
              <Field
                label="Start time"
                name="time"
                type="time"
                step={300}
                inputRef={timeRef}
                value={form.time}
                onChange={set("time")}
                onBlur={blur("time")}
                error={touched.time && errors.time}
              />
            </div>

            <p className="bf-when-note">
              Pick any time — the faculty member sees the request either way
              and can suggest another.
            </p>
          </div>
        )}
      </div>

      {prefilled && (
        <p className="bf-prefilled">
          Your details are filled in from last time.{" "}
          <button
            type="button"
            onClick={() => {
              forget();
              // The slot is not one of "your details" — clearing it here
              // would throw away the time the student just chose.
              setForm((prev) => ({
                ...EMPTY,
                duration_min: prev.duration_min,
                date: prev.date,
                time: prev.time,
              }));
              setErrors({});
              setTouched({});
              setPrefilled(false);
            }}
          >
            Not you? Clear details
          </button>
        </p>
      )}

      <Field
        label="Full name"
        name="name"
        value={form.name}
        onChange={set("name")}
        onBlur={blur("name")}
        error={touched.name && errors.name}
        autoComplete="name"
      />

      <div className="bf-row">
        <Field
          label="Roll number"
          name="roll_no"
          value={form.roll_no}
          onChange={set("roll_no")}
          onBlur={blur("roll_no")}
          error={touched.roll_no && errors.roll_no}
          placeholder="BL.EN.U4EAC23051"
          spellCheck={false}
        />
        <Field
          label="Branch"
          name="branch"
          value={form.branch}
          onChange={set("branch")}
          onBlur={blur("branch")}
          error={touched.branch && errors.branch}
          placeholder="Electronics and Computer Engineering"
        />
      </div>

      <div className="bf-row">
        <Field
          label="Semester"
          name="semester"
          as="select"
          value={form.semester}
          onChange={set("semester")}
          onBlur={blur("semester")}
          error={touched.semester && errors.semester}
        >
          <option value="">Select</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Field>

        <Field
          label="Section"
          name="section"
          optional
          value={form.section}
          onChange={set("section")}
          placeholder="A"
        />
      </div>

      <Field
        label="College email"
        name="email"
        type="email"
        value={form.email}
        onChange={set("email")}
        onBlur={blur("email")}
        error={touched.email && errors.email}
        placeholder={`yourname@${ALLOWED_EMAIL_DOMAIN}`}
        autoComplete="email"
        spellCheck={false}
      />

      <Field
        label="What is it about?"
        name="purpose"
        as="textarea"
        value={form.purpose}
        onChange={set("purpose")}
        onBlur={blur("purpose")}
        error={touched.purpose && errors.purpose}
        placeholder="Doubt in the speech processing project — feature extraction stage"
        rows={3}
        maxLength={PURPOSE_MAX + 40}
        hint={
          <span className={left < 0 ? "over" : ""}>
            {left} characters left
          </span>
        }
      />

      <Field
        label="How long do you need?"
        name="duration_min"
        as="select"
        value={form.duration_min}
        onChange={set("duration_min")}
      >
        {DURATIONS.map((n) => (
          <option key={n} value={n}>
            {n} minutes
          </option>
        ))}
      </Field>

      {failure && (
        <p className="bf-failure" role="alert">
          {failure}
        </p>
      )}

      {!failure && whenError && (
        <p className="bf-failure" role="alert">
          {whenError}
        </p>
      )}

      <div className="bf-actions">
        <button type="button" className="booking-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="bf-submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="spin" size={16} strokeWidth={2} />
              Preparing…
            </>
          ) : (
            "Review the email"
          )}
        </button>
      </div>

      <p className="bf-assurance">
        Nothing is sent yet — you&apos;ll see the email first.
      </p>
    </form>
  );
}

/* ------------------------------------------------------------
   One field, one error, one place. aria-invalid and
   aria-describedby are what make the inline errors reach a
   screen reader rather than just sighted users.
------------------------------------------------------------ */

function Field({
  label,
  name,
  as = "input",
  error,
  hint,
  optional,
  children,
  inputRef,
  ...props
}) {
  const id = `bf-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const Tag = as;

  return (
    <div className={`bf-field ${error ? "invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="bf-optional">optional</span>}
      </label>

      <Tag
        id={id}
        name={name}
        ref={inputRef}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={
          [error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        {...props}
      >
        {children}
      </Tag>

      {error && (
        <p className="bf-error" id={errorId}>
          {error}
        </p>
      )}
      {hint && (
        <p className="bf-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}