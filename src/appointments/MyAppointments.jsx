import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { lookupAppointments, cancelAppointment, answerProposal } from "./api.js";
import { readAppointmentIds } from "./appointmentIds.js";
import { formatSlot, formatSlotLong } from "./slot.js";
import CancelDialog from "./CancelDialog.jsx";
import "./myappointments.css";

const POLL_MS = 30_000;

const TONE = {
  draft: "mute",
  pending: "wait",
  rescheduled: "info",
  accepted: "good",
  declined: "bad",
  cancelled: "mute",
  expired: "mute",
};

const LABEL = {
  draft: "Not sent",
  pending: "Waiting for a reply",
  rescheduled: "New time suggested",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

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

/**
 * Every appointment this browser has made, and what can still be done with
 * each one.
 *
 * The buttons come from the backend's `actions` flags and nowhere else. The
 * frontend knowing that, say, a declined request cannot be cancelled would
 * mean two copies of that rule, and the copy in the browser would be the one
 * that quietly goes out of date.
 */
export default function MyAppointments({ onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [known, setKnown] = useState(() => readAppointmentIds());

  const [cancelling, setCancelling] = useState(null); // the card being cancelled
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [rowBusy, setRowBusy] = useState({});          // id -> "accept" | "decline"
  const [rowError, setRowError] = useState({});

  const panelRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const ids = readAppointmentIds();
    setKnown(ids);

    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!quiet) setLoading(true);
    try {
      const body = await lookupAppointments(ids);
      const list = Array.isArray(body?.appointments) ? body.appointments : [];
      setItems(list);                 // already sorted newest first by the server
      setError(null);
    } catch (err) {
      setError(detailOf(err, "Couldn't load your appointments. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Open means watching. A hidden tab is skipped rather than polled.
  useEffect(() => {
    let timer = null;
    let stopped = false;

    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      await load({ quiet: true });
      schedule();
    }
    schedule();
    return () => { stopped = true; clearTimeout(timer); };
  }, [load]);

  // Escape closes the panel, unless a dialog is up — that one goes first.
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && !cancelling) onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cancelling, onClose]);

  function replaceCard(card) {
    if (!card?.appointment_id) return;
    setItems((prev) =>
      prev.map((item) =>
        item.appointment_id === card.appointment_id ? { ...item, ...card } : item
      )
    );
  }

  async function confirmCancel(reason) {
    if (!cancelling) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      const card = await cancelAppointment(cancelling.appointment_id, reason);
      replaceCard(card);
      setCancelling(null);
    } catch (err) {
      if (err?.status === 422) {
        // The reason itself was the problem, so the dialog stays put.
        setDialogError(detailOf(err, "That reason is too short."));
      } else if (err?.status === 409) {
        // Something changed underneath: close and show the truth.
        setCancelling(null);
        setRowError((prev) => ({
          ...prev,
          [cancelling.appointment_id]: detailOf(err, "This can no longer be cancelled."),
        }));
        load({ quiet: true });
      } else {
        setDialogError(detailOf(err, "That didn't go through. Try again in a moment."));
      }
    } finally {
      setDialogBusy(false);
    }
  }

  async function respond(item, action) {
    const id = item.appointment_id;
    setRowBusy((prev) => ({ ...prev, [id]: action }));
    setRowError((prev) => ({ ...prev, [id]: null }));
    try {
      const card = await answerProposal(id, action);
      replaceCard(card);
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [id]: detailOf(err, "That didn't go through. Try again in a moment."),
      }));
      if (err?.status === 409) load({ quiet: true });
    } finally {
      setRowBusy((prev) => ({ ...prev, [id]: null }));
    }
  }

  const nothingSaved = known.length === 0;

  /* Rendered into <body>, not where it sits in the tree.
     z-index only ranks siblings inside the same stacking context, and any
     ancestor with a transform, filter, opacity or backdrop-filter starts a
     new one — so an overlay nested in the desk can be trapped beneath the
     portal's own header or composer no matter how large its z-index is.
     A portal sidesteps the whole question. */
  const overlay = (
    <div
      className="ma-scrim ma-scrim-panel"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside
        className="ma-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ma-title"
      >
        <header className="ma-head">
          <h2 id="ma-title">My appointments</h2>
          <button type="button" className="ma-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="ma-body">
          {loading && items.length === 0 && !nothingSaved && (
            <p className="ma-note" role="status">
              <span className="ma-spinner" aria-hidden="true" />
              Loading your appointments…
            </p>
          )}

          {error && (
            <p className="ma-error" role="alert">
              {error}{" "}
              <button type="button" className="ma-link" onClick={() => load()}>
                Try again
              </button>
            </p>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="ma-empty">
              <p>No appointments yet.</p>
              <p className="ma-empty-sub">
                Ask when a faculty member is free to book one.
              </p>
            </div>
          )}

          {items.map((item) => {
            const id = item.appointment_id;
            const actions = item.actions ?? {};
            const tone = TONE[item.status] ?? "mute";
            const busy = rowBusy[id];

            return (
              <article
                key={id}
                className={`ma-card tone-${tone} ${item.is_past ? "is-past" : ""}`}
              >
                <div className="ma-card-head">
                  <span className="ma-badge">{LABEL[item.status] ?? item.status}</span>
                  {item.is_past && <span className="ma-past">Past</span>}
                </div>

                <h3 className="ma-faculty">{item.faculty || "Faculty member"}</h3>

                <p className="ma-when">
                  {item.proposed_slot ? (
                    <>
                      <s>{formatSlot(item.slot, item.end)}</s>
                      {/* The length belongs to the time it describes, so it
                          rides on the new line rather than trailing below
                          both of them on its own. */}
                      <span className="ma-new">
                        {formatSlotLong(item.proposed_slot)}
                        {item.duration_min ? (
                          <span className="ma-len"> · {item.duration_min} min</span>
                        ) : null}
                      </span>
                    </>
                  ) : (
                    <>
                      {formatSlot(item.slot, item.end) || "Time not set"}
                      {item.duration_min ? (
                        <span className="ma-len"> · {item.duration_min} min</span>
                      ) : null}
                    </>
                  )}
                </p>

                {item.purpose && <p className="ma-purpose">{item.purpose}</p>}

                {item.faculty_note && (
                  <blockquote className="ma-quote">
                    <span className="ma-quote-who">{item.faculty || "They"} wrote</span>
                    {item.faculty_note}
                  </blockquote>
                )}

                {item.cancel_reason && (
                  <blockquote className="ma-quote ma-quote-mute">
                    <span className="ma-quote-who">Cancelled because</span>
                    {item.cancel_reason}
                  </blockquote>
                )}

                {rowError[id] && (
                  <p className="ma-error ma-error-row" role="alert">
                    {rowError[id]}
                  </p>
                )}

                {(actions.answer_proposal || actions.cancel) && (
                  <div className="ma-actions">
                    {actions.answer_proposal && (
                      <>
                        <button
                          type="button"
                          className="ma-btn ma-btn-primary"
                          onClick={() => respond(item, "accept")}
                          disabled={Boolean(busy)}
                        >
                          {busy === "accept" ? "Confirming…" : "Accept new time"}
                        </button>
                        <button
                          type="button"
                          className="ma-btn"
                          onClick={() => respond(item, "decline")}
                          disabled={Boolean(busy)}
                        >
                          {busy === "decline" ? "Sending…" : "Decline"}
                        </button>
                      </>
                    )}
                    {actions.cancel && (
                      <button
                        type="button"
                        className="ma-btn ma-btn-quiet"
                        onClick={() => {
                          setDialogError(null);
                          setCancelling(item);
                        }}
                        disabled={Boolean(busy)}
                      >
                        {item.status === "draft" ? "Discard" : "Cancel"}
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </aside>

      {cancelling && (
        <CancelDialog
          faculty={cancelling.faculty}
          needsReason={Boolean(cancelling.actions?.cancel_needs_reason)}
          busy={dialogBusy}
          error={dialogError}
          onConfirm={confirmCancel}
          onClose={() => {
            if (!dialogBusy) {
              setCancelling(null);
              setDialogError(null);
            }
          }}
        />
      )}
    </div>
  );

  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}