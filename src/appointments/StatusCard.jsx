import { useCallback, useEffect, useState } from "react";
import { getAppointmentStatus, cancelAppointment } from "./api.js";
import { formatSlot } from "./slot.js";
import CancelDialog from "./CancelDialog.jsx";
import "./status.css";

const POLL_MS = 30_000;

/* Only these two can still change on their own. Polling a decided request
   forever would be asking a question already answered. */
const LIVE = new Set(["pending", "rescheduled"]);

/* Three consecutive failures is a backend that is down, not a blip. Stop and
   hand the student a button rather than retrying into the void all evening. */
const GIVE_UP_AFTER = 3;

/* /status may answer flat, or with the record under a key. Both are
   reasonable designs; silently merging the wrong one is not — the card
   would sit on "pending" forever while the backend said otherwise, with
   nothing on screen to suggest anything was wrong. */
function unwrap(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.status === "string") return payload;
  for (const key of ["appointment", "booking_status", "message", "data", "result"]) {
    const inner = payload[key];
    if (inner && typeof inner === "object" && typeof inner.status === "string") {
      return inner;
    }
  }
  return null;
}

const LOOK = {
  pending: { tone: "wait", label: "Waiting for a reply" },
  rescheduled: { tone: "info", label: "Another time suggested" },
  accepted: { tone: "good", label: "Accepted" },
  declined: { tone: "bad", label: "Declined" },
  cancelled: { tone: "mute", label: "Cancelled" },
  expired: { tone: "mute", label: "Expired" },
};

function formatChecked(date) {
  if (!date) return "";
  const hour = date.getHours() % 12 || 12;
  const suffix = date.getHours() < 12 ? "am" : "pm";
  return `${hour}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
}

/* ---------------------------------------------------------------- card */

export default function StatusCard({ message }) {
  const [state, setState] = useState(message);
  const [checkedAt, setCheckedAt] = useState(null);
  const [failures, setFailures] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);   // dialog open
  const [cancelBusy, setCancelBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [whyStuck, setWhyStuck] = useState(null);

  /* There is deliberately no "is it still mounted" ref here.
     React 18 made setState-after-unmount a silent no-op, so such a guard
     prevents nothing — while a single missed reset turns every response
     into a discarded one and freezes the card. The poll's own cancelled
     flag already stops it scheduling more work after unmount, which is
     the part that actually matters. */

  const appointmentId = state?.appointment_id ?? message?.appointment_id;
  const status = state?.status ?? "pending";
  const live = LIVE.has(status);
  const stalled = failures >= GIVE_UP_AFTER;

  const refresh = useCallback(async () => {
    if (!appointmentId) return;
    setRefreshing(true);
    try {
      // A request that never settles would leave the card spinning with no
      // error and nothing to click, so it is given a deadline of its own.
      const body = await Promise.race([
        getAppointmentStatus(appointmentId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("The server didn't answer in time.")), 15_000)
        ),
      ]);

      const next = unwrap(body);
      if (!next) {
        // A 200 with no status in it is a failure, not a quiet success.
        setWhyStuck(
          "The server replied without a status. Check what " +
            `GET /desk/appointments/${appointmentId}/status returns.`
        );
        setFailures((n) => n + 1);
        return;
      }

      // Merged, not replaced: /status may answer with less than confirm did,
      // and dropping the faculty name would blank the card mid-wait.
      setState((prev) => ({ ...prev, ...next }));
      setFailures(0);
      setWhyStuck(null);
      setCheckedAt(new Date());
    } catch (error) {
      const text = error?.detail ?? error?.message;
      setWhyStuck(
        typeof text === "string" && text.trim() && !/^request failed/i.test(text)
          ? text.trim()
          : null
      );
      setFailures((n) => n + 1);
    } finally {
      // Unconditional. A stray setState after unmount is a no-op in React
      // 18, whereas a spinner that never clears is a dead card.
      setRefreshing(false);
    }
  }, [appointmentId]);

  /* The poll. Restarted whenever the status changes, which is also how it
     stops: once the status is terminal, LIVE is false and nothing is
     scheduled. A hidden tab is skipped rather than polled — a phone in a
     pocket should not be asking every thirty seconds — and becoming visible
     checks straight away, so coming back shows the answer at once. */
  useEffect(() => {
    if (!live || stalled || !appointmentId) return undefined;

    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      await refresh();
      schedule();
    }

    function onVisibility() {
      if (document.hidden || cancelled) return;
      clearTimeout(timer);
      tick();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, stalled, appointmentId, refresh]);

  /* The same dialog as the panel, because a sent request needs a reason
     wherever it is cancelled from. Which shape it takes comes from the
     backend's flag when there is one, falling back to "a draft needs no
     reason, anything else does". */
  const needsReason = state?.actions?.cancel_needs_reason ?? status !== "draft";

  async function cancel(reason) {
    setCancelBusy(true);
    setProblem(null);
    try {
      const next = await cancelAppointment(appointmentId, reason);
      setState((prev) => ({ ...prev, ...next, status: next?.status ?? "cancelled" }));
      setCancelling(false);
    } catch (error) {
      setProblem(
        error?.detail && !/^request failed/i.test(error.detail)
          ? error.detail
          : error?.message && !/^request failed/i.test(error.message)
          ? error.message
          : "Couldn't cancel that. Try again in a moment."
      );
      if (error?.status !== 422) setCancelling(false);
    } finally {
      setCancelBusy(false);
    }
  }

  const look = LOOK[status] ?? { tone: "mute", label: status };
  const faculty = state?.faculty || "the faculty member";
  const slot = formatSlot(state?.slot, state?.end);
  const proposed = formatSlot(state?.proposed_slot);

  return (
    <section className={`status-card tone-${look.tone}`} aria-label="Appointment request">
      <header className="status-head">
        <span className="status-pill">
          {status === "pending" && <span className="status-dot" aria-hidden="true" />}
          {look.label}
        </span>
        <span className="status-ref">#{String(appointmentId ?? "").slice(0, 8)}</span>
      </header>

      <h3 className="status-line" aria-live="polite">
        {status === "pending" && <>Waiting for {faculty} to reply.</>}
        {status === "accepted" && <>{faculty} accepted your request.</>}
        {status === "declined" && <>{faculty} can't make this one.</>}
        {status === "rescheduled" && <>{faculty} suggested another time.</>}
        {status === "cancelled" && <>You cancelled this request.</>}
        {status === "expired" && <>No reply came within 24 hours.</>}
        {!LOOK[status] && <>This request is {status}.</>}
      </h3>

      <dl className="status-when">
        <div className={proposed ? "is-superseded" : ""}>
          <dt>{proposed ? "You asked for" : "When"}</dt>
          <dd>{slot || "—"}</dd>
        </div>
        {proposed && (
          <div className="is-proposed">
            <dt>They suggest</dt>
            <dd>{proposed}</dd>
          </div>
        )}
        {state?.duration_min && !proposed && (
          <div>
            <dt>Length</dt>
            <dd>{state.duration_min} minutes</dd>
          </div>
        )}
      </dl>

      {state?.faculty_note && (
        <blockquote className="status-note">
          <span className="status-note-who">{faculty} wrote</span>
          {state.faculty_note}
        </blockquote>
      )}

      {status === "rescheduled" && (
        <p className="status-next">
          Use the link in your email to accept or decline the new time.
        </p>
      )}

      {status === "expired" && (
        <p className="status-next">
          The reply link has expired. Ask again to send a fresh request.
        </p>
      )}

      {problem && (
        <p className="status-problem" role="alert">{problem}</p>
      )}

      {/* Only exists while something can still happen. A decided request
          would otherwise end on a divider with nothing beneath it. */}
      {(live || stalled) && (
      <footer className="status-foot">
        {live && !stalled && (
          <span className="status-watch">
            {refreshing ? (
              <>
                <span className="status-spinner" aria-hidden="true" />
                Checking…
              </>
            ) : checkedAt ? (
              <>Checked at {formatChecked(checkedAt)} · rechecks every 30s</>
            ) : (
              <>Checking every 30 seconds</>
            )}
          </span>
        )}

        {stalled && (
          <span className="status-watch is-stalled" role="status">
            {whyStuck || "Couldn't check for updates."}
          </span>
        )}

        <span className="status-actions">
          {live && (
            <button
              type="button"
              className="status-btn"
              onClick={() => {
                setFailures(0);
                refresh();
              }}
              disabled={refreshing}
            >
              {stalled ? "Try again" : "Check now"}
            </button>
          )}
          {live && (
            <button
              type="button"
              className="status-btn status-btn-quiet"
              onClick={() => { setProblem(null); setCancelling(true); }}
              disabled={cancelBusy}
            >
              Cancel request
            </button>
          )}
        </span>
      </footer>
      )}

      {cancelling && (
        <CancelDialog
          faculty={state?.faculty}
          needsReason={needsReason}
          busy={cancelBusy}
          error={problem}
          onConfirm={cancel}
          onClose={() => { if (!cancelBusy) { setCancelling(false); setProblem(null); } }}
        />
      )}
    </section>
  );
}