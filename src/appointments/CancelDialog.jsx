import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./myappointments.css";

const REASON_MIN = 5;
const REASON_MAX = 300;

/**
 * Cancelling, in the two shapes it actually has.
 *
 * An unsent draft is just a tidy-up: nobody has been emailed, so it asks
 * once and gets out of the way. A sent request is a message to a person who
 * has already set time aside, so it asks for a reason and sends it on.
 *
 * Which of the two it is comes from the backend's cancel_needs_reason flag,
 * never from the frontend guessing at the status.
 */
export default function CancelDialog({
  faculty,
  needsReason,
  busy,
  error,
  onConfirm,
  onClose,
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const firstRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  // Escape closes, as it does in every other dialog anyone has used.
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const text = reason.trim();
  const tooShort = text.length < REASON_MIN;
  const left = REASON_MAX - reason.length;
  const blocked = needsReason && tooShort;

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (blocked || busy) return;
    onConfirm(needsReason ? text : undefined);
  }

  // Same reasoning as the panel: straight into <body>.
  const overlay = (
    <div
      className="ma-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="ma-dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ma-dialog-title"
        onSubmit={submit}
      >
        <h2 className="ma-dialog-title" id="ma-dialog-title">
          {needsReason ? "Cancel this appointment?" : "Discard this draft?"}
        </h2>

        {needsReason ? (
          <>
            <label className="ma-dialog-label" htmlFor="ma-reason">
              Why are you cancelling?
              <span className="ma-dialog-hint">
                sent to {faculty || "the faculty member"}
              </span>
            </label>
            <textarea
              id="ma-reason"
              ref={firstRef}
              className="ma-dialog-input"
              value={reason}
              rows={3}
              maxLength={REASON_MAX}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && tooShort ? "true" : undefined}
              aria-describedby="ma-reason-help"
              placeholder="e.g. I've sorted it out over email, sorry for the trouble."
              disabled={busy}
            />
            <div className="ma-dialog-meter" id="ma-reason-help">
              <span className={touched && tooShort ? "ma-dialog-warn" : ""}>
                {touched && tooShort
                  ? `At least ${REASON_MIN} characters.`
                  : "They'll see this."}
              </span>
              <span className={left < 40 ? "ma-dialog-warn" : ""}>
                {left} characters left
              </span>
            </div>
          </>
        ) : (
          <p className="ma-dialog-body">
            Nothing has been sent for this one, so there is nobody to tell.
            It will simply be removed.
          </p>
        )}

        {error && (
          <p className="ma-dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="ma-dialog-actions">
          <button
            type="button"
            className="ma-btn"
            onClick={onClose}
            disabled={busy}
            ref={needsReason ? undefined : firstRef}
          >
            Keep it
          </button>
          <button type="submit" className="ma-btn ma-btn-danger" disabled={busy || blocked}>
            {busy ? (
              <>
                <span className="ma-spinner" aria-hidden="true" />
                Cancelling…
              </>
            ) : needsReason ? (
              "Cancel appointment"
            ) : (
              "Discard draft"
            )}
          </button>
        </div>
      </form>
    </div>
  );

  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}