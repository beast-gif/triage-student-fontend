import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { getRespondRequest, submitResponse } from "./api.js";
import { formatClock, formatSlot, formatSlotLong, todayInIST } from "./slot.js";
import "./respond.css";

/**
 * What a faculty member sees when they open the link in the request email.
 *
 * Opening the link must never change anything. The ?action= in the URL only
 * preselects a choice — the page still waits for Submit. Three separate
 * links in the email would otherwise mean a request gets declined because
 * someone's mail client prefetched a URL, or because a thumb landed on the
 * wrong word on a phone.
 *
 * Likely read on a phone, standing in a corridor, by someone who did not
 * ask for this. So: the request first, in full, then the reply.
 */

const ACTIONS = [
  {
    value: "accept",
    title: "Accept",
    blurb: "The student is told this time is confirmed.",
    submit: "Accept and notify the student",
  },
  {
    // The wire value stays "propose": it is what the backend expects and
    // what ?action=propose in the email link matches against. Only the
    // words a faculty member reads have changed.
    value: "propose",
    title: "Reschedule",
    blurb: "Pick a new time for the appointment. The student will be asked to confirm it.",
    submit: "Send the new time",
  },
  {
    value: "decline",
    title: "Decline",
    blurb: "The student is told this one cannot happen.",
    submit: "Decline and notify the student",
  },
];

const NOTE_MAX = 500;
const VALID = new Set(ACTIONS.map((a) => a.value));

/* FastAPI's detail is the message worth reading. Everything else is a
   status line dressed up as a sentence. */
function detailOf(error, fallback) {
  const text = error?.detail ?? error?.message;
  if (typeof text === "string") {
    const trimmed = text.trim();
    if (trimmed && !/^(request failed|not found|internal server error)\b/i.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

export default function RespondPage() {
  const { appointmentId } = useParams();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";
  const preset = search.get("action");

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [closed, setClosed] = useState(null);   // 410 on load: link spent
  const [loadError, setLoadError] = useState(null);

  const [action, setAction] = useState(VALID.has(preset) ? preset : "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);

  const errorRef = useRef(null);
  const proposeRef = useRef(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setLoadError(
        "This link is incomplete. Open it straight from the email rather than " +
          "copying part of the address."
      );
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getRespondRequest(appointmentId, token);
      setRequest(data);
    } catch (error) {
      if (error?.status === 410 || error?.status === 404) {
        setClosed(detailOf(error, "This link is no longer valid."));
      } else {
        setLoadError(
          detailOf(error, "Couldn't load this request. Check your connection and try again.")
        );
      }
    } finally {
      setLoading(false);
    }
  }, [appointmentId, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (formError && errorRef.current) errorRef.current.focus();
  }, [formError]);

  // Opening with ?action=propose should land on the picker, not above it.
  useEffect(() => {
    if (action === "propose" && request && proposeRef.current) {
      proposeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [action, request]);

  function chooseSuggestion(slot) {
    setAction("propose");
    setDate(slot.date);
    setTime(slot.start);
    setFormError(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;

    if (!action) {
      setFormError("Pick accept, decline, or reschedule.");
      return;
    }
    if (action === "propose" && (!date || !time)) {
      setFormError("Pick a date and a time for the new slot.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const payload = { token, action };
    if (note.trim()) payload.note = note.trim();
    if (action === "propose") payload.proposed_slot = `${date}T${time}`;

    try {
      const result = await submitResponse(appointmentId, payload);
      setDone({
        status: result?.status ?? action,
        detail: result?.detail ?? "Done. The student has been notified.",
      });
    } catch (error) {
      if (error?.status === 410) {
        // Someone already answered. The form is no longer a real choice.
        setClosed(detailOf(error, "This request has already been answered."));
      } else {
        setFormError(
          detailOf(error, "That didn't go through. Try again in a moment.")
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------------------------------------- shells */

  if (loading) {
    return (
      <Shell>
        <div className="rp-card rp-loading" role="status">
          <span className="rp-spinner" aria-hidden="true" />
          Loading the request…
        </div>
      </Shell>
    );
  }

  if (closed) {
    return (
      <Shell>
        <div className="rp-card rp-final tone-mute">
          <h1>Nothing left to do</h1>
          <p>{closed}</p>
          <p className="rp-quiet">You can close this page.</p>
        </div>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <div className="rp-card rp-final tone-bad">
          <h1>Couldn't open this request</h1>
          <p>{loadError}</p>
          {token && (
            <button type="button" className="rp-btn rp-btn-primary" onClick={load}>
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (done) {
    const tone =
      done.status === "accepted" ? "good" :
      done.status === "declined" ? "bad" : "info";
    const heading =
      done.status === "accepted" ? "Accepted" :
      done.status === "declined" ? "Declined" : "New time sent";
    return (
      <Shell>
        <div className={`rp-card rp-final tone-${tone}`}>
          <h1>{heading}</h1>
          <p>{done.detail}</p>
          <p className="rp-quiet">You can close this page.</p>
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------- form */

  const student = request?.student ?? {};
  const chosen = ACTIONS.find((a) => a.value === action);
  const alreadyAnswered = request?.status && request.status !== "pending";
  const suggestions = Array.isArray(request?.suggested_slots) ? request.suggested_slots : [];

  const who = [student.branch, student.semester && `Semester ${student.semester}`,
               student.section && `Section ${student.section}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <Shell>
      {alreadyAnswered && (
        <p className="rp-banner" role="status">
          This request is already marked <strong>{request.status}</strong>.
        </p>
      )}

      <section className="rp-card rp-request">
        <p className="rp-eyebrow">Appointment request</p>
        <h1 className="rp-when">{formatSlotLong(request?.slot) || "—"}</h1>
        <p className="rp-duration">
          {request?.duration_min ? `${request.duration_min} minutes` : "Duration not set"}
          {request?.faculty ? ` · with ${request.faculty}` : ""}
        </p>

        <dl className="rp-facts">
          <div>
            <dt>Student</dt>
            <dd>
              {student.name || "—"}
              {student.roll_no && <span className="rp-sub">{student.roll_no}</span>}
            </dd>
          </div>
          {who && (
            <div>
              <dt>Class</dt>
              <dd>{who}</dd>
            </div>
          )}
          {student.email && (
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${student.email}`}>{student.email}</a>
              </dd>
            </div>
          )}
          {request?.purpose && (
            <div>
              <dt>About</dt>
              <dd>{request.purpose}</dd>
            </div>
          )}
        </dl>

        {request?.message && (
          <blockquote className="rp-message">
            <span className="rp-message-who">{student.name || "The student"} wrote</span>
            {request.message}
          </blockquote>
        )}
      </section>

      <form className="rp-card rp-reply" onSubmit={submit} noValidate>
        <fieldset className="rp-choices">
          <legend>Your reply</legend>

          {ACTIONS.map((option) => (
            <label
              key={option.value}
              className={`rp-choice ${action === option.value ? "is-on" : ""}`}
            >
              <input
                type="radio"
                name="action"
                value={option.value}
                checked={action === option.value}
                onChange={() => {
                  setAction(option.value);
                  setFormError(null);
                }}
              />
              <span className="rp-choice-body">
                <span className="rp-choice-title">{option.title}</span>
                <span className="rp-choice-blurb">{option.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {action === "propose" && (
          <div className="rp-propose" ref={proposeRef}>
            {suggestions.length > 0 && (
              <>
                <p className="rp-label">
                  Free in your timetable
                  <span className="rp-hint">tap one to fill it in</span>
                </p>
                <div className="rp-chips">
                  {suggestions.map((slot, index) => {
                    const on = date === slot.date && time === slot.start;
                    return (
                      <button
                        key={`${slot.date}-${slot.start}-${index}`}
                        type="button"
                        className={`rp-chip ${on ? "is-on" : ""}`}
                        onClick={() => chooseSuggestion(slot)}
                        aria-pressed={on}
                      >
                        <span className="rp-chip-day">{formatSlot(slot.date)}</span>
                        <span className="rp-chip-time">
                          {formatClock(slot.start)}
                          {slot.end ? ` – ${formatClock(slot.end)}` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="rp-pickers">
              <label className="rp-field">
                <span className="rp-label">Date</span>
                <input
                  type="date"
                  value={date}
                  min={todayInIST()}
                  onChange={(e) => { setDate(e.target.value); setFormError(null); }}
                  required
                />
              </label>
              <label className="rp-field">
                <span className="rp-label">Start time</span>
                <input
                  type="time"
                  value={time}
                  step={300}
                  onChange={(e) => { setTime(e.target.value); setFormError(null); }}
                  required
                />
              </label>
            </div>

            {date && time && (
              <p className="rp-echo">
                Suggesting <strong>{formatSlotLong(`${date}T${time}`)}</strong>
              </p>
            )}
          </div>
        )}

        <label className="rp-field rp-note-field">
          <span className="rp-label">
            Note for the student
            <span className="rp-hint">optional</span>
          </span>
          <textarea
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              action === "decline"
                ? "e.g. I'm travelling that week — email me your draft instead."
                : "e.g. Meet at cabin 204, second floor."
            }
          />
          <span className="rp-counter">
            {NOTE_MAX - note.length} characters left
          </span>
        </label>

        {formError && (
          <p className="rp-error" role="alert" tabIndex={-1} ref={errorRef}>
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="rp-btn rp-btn-primary rp-submit"
          disabled={submitting}
        >
          {submitting ? (
            <>
              <span className="rp-spinner" aria-hidden="true" />
              Sending…
            </>
          ) : (
            chosen?.submit ?? "Send your reply"
          )}
        </button>

        <p className="rp-foot">
          Nothing is sent until you press this. The link works once.
        </p>
      </form>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="rp-page">
      <header className="rp-top">
        <span className="rp-mark">TRIAGE</span>
        <span className="rp-org">Amrita Vishwa Vidyapeetham, Bengaluru</span>
      </header>
      <main className="rp-main">{children}</main>
    </div>
  );
}