import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { getStudentResponse, submitStudentResponse } from "./api.js";
import { formatSlot, formatSlotLong } from "./slot.js";
import "./respond.css";
import "./reschedule.css";

/**
 * What a student sees when the faculty member suggests a different time.
 *
 * The decision is "is this new time any good to me?", so the two times sit
 * next to each other with the old one struck through — a page that showed
 * only the new time would be asking them to remember what they originally
 * asked for.
 *
 * Opening the link changes nothing, same as the faculty page: the GET is
 * read-only and the token is spent on submit.
 *
 * It shares respond.css, because it is the same kind of page — reached
 * from an email, by someone not logged in, usually on a phone — and the
 * two should not drift apart.
 */

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

export default function ReschedulePage() {
  const { appointmentId } = useParams();
  const [search] = useSearchParams();
  const token = search.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [closed, setClosed] = useState(null);     // 410: link spent
  const [loadError, setLoadError] = useState(null);

  const [submitting, setSubmitting] = useState(null); // "accept" | "decline"
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(null);

  const errorRef = useRef(null);

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
      const data = await getStudentResponse(appointmentId, token);
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

  async function answer(action) {
    if (submitting) return;
    setSubmitting(action);
    setFormError(null);
    try {
      const result = await submitStudentResponse(appointmentId, { token, action });
      setDone(result ?? { status: action === "accept" ? "accepted" : "declined" });
    } catch (error) {
      if (error?.status === 410) {
        // Already answered elsewhere. Buttons would be offering a choice
        // that no longer exists.
        setClosed(detailOf(error, "This request has already been answered."));
      } else {
        // 409 included: the suggested time went while they were deciding,
        // which is exactly when the buttons should stay put.
        setFormError(detailOf(error, "That didn't go through. Try again in a moment."));
      }
    } finally {
      setSubmitting(null);
    }
  }

  /* ------------------------------------------------------------- shells */

  if (loading) {
    return (
      <Shell>
        <div className="rp-card rp-loading" role="status">
          <span className="rp-spinner" aria-hidden="true" />
          Loading the suggestion…
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
          <h1>Couldn't open this</h1>
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
    const accepted = done.status === "accepted";
    return (
      <Shell>
        <div className={`rp-card rp-final ${accepted ? "tone-good" : "tone-mute"}`}>
          <h1>{accepted ? "Confirmed" : "Declined"}</h1>
          {accepted ? (
            <>
              <p>
                You're meeting {done.faculty || request?.faculty || "them"} on{" "}
                <strong>{formatSlotLong(done.slot) || formatSlotLong(request?.proposed_slot)}</strong>.
              </p>
              {done.faculty_note && <p className="rp-quiet">{done.faculty_note}</p>}
            </>
          ) : (
            <p>
              {request?.faculty || "They"} has been told the new time doesn't work.
              You can ask again from the desk whenever you like.
            </p>
          )}
          <p className="rp-quiet">You can close this page.</p>
        </div>
      </Shell>
    );
  }

  /* ------------------------------------------------------------- choice */

  const faculty = request?.faculty || "The faculty member";
  const original = formatSlot(request?.original_slot);
  const proposed = formatSlotLong(request?.proposed_slot);
  const settled = request?.status && request.status !== "rescheduled";

  return (
    <Shell>
      {settled && (
        <p className="rp-banner" role="status">
          This request is already marked <strong>{request.status}</strong>.
        </p>
      )}

      <section className="rp-card">
        <p className="rp-eyebrow">New time suggested</p>
        <h1 className="rs-headline">{faculty} can't make your original time.</h1>

        <div className="rs-compare">
          <div className="rs-was">
            <span className="rs-label">You asked for</span>
            <s>{original || "—"}</s>
          </div>

          <span className="rs-arrow" aria-hidden="true">↓</span>

          <div className="rs-now">
            <span className="rs-label">They suggest</span>
            <strong>{proposed || "—"}</strong>
            {request?.duration_min && (
              <span className="rs-len">{request.duration_min} minutes</span>
            )}
          </div>
        </div>

        {request?.faculty_note && (
          <blockquote className="rp-message rs-note">
            <span className="rp-message-who">{faculty} wrote</span>
            {request.faculty_note}
          </blockquote>
        )}

        {formError && (
          <p className="rp-error rs-error" role="alert" tabIndex={-1} ref={errorRef}>
            {formError}
          </p>
        )}

        <div className="rs-actions">
          <button
            type="button"
            className="rp-btn rp-btn-primary rs-accept"
            onClick={() => answer("accept")}
            disabled={submitting !== null}
          >
            {submitting === "accept" ? (
              <>
                <span className="rp-spinner" aria-hidden="true" />
                Confirming…
              </>
            ) : (
              "Accept new time"
            )}
          </button>
          <button
            type="button"
            className="rp-btn rs-decline"
            onClick={() => answer("decline")}
            disabled={submitting !== null}
          >
            {submitting === "decline" ? "Sending…" : "Decline"}
          </button>
        </div>

        <p className="rp-foot">
          Accepting confirms the appointment for the new time. This link works once.
        </p>
      </section>
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