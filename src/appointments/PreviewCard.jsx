import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAppointment, cancelAppointment } from "./api.js";
import "./preview.css";

const MESSAGE_MAX = 1000;

/* The email body arrives as HTML from the backend. It is rendered inside an
   iframe with an empty sandbox attribute, which switches off scripts, forms,
   popups, top-level navigation and same-origin access all at once. Nothing in
   that HTML can reach the portal around it.

   It is deliberately rendered on white with dark text whatever theme the
   portal is in, because that is how it will look in the faculty member's
   mail client. A preview that matched the dark portal would be lying about
   the thing it is previewing. */
/* Email HTML is written for mail clients, which are wide. Dropped into a
   narrow preview it overflows sideways, and a horizontal scrollbar in a
   thread is useless — the student just sees sentences cut in half. These
   rules force everything to wrap instead. They are last in the cascade, so
   they win over whatever the backend's own styles say. */
const CONTAIN = `
  :root { color-scheme: light; }
  html { overflow-x: hidden; }
  body {
    /* The extra room at the foot keeps the expand button off the last line. */
    margin: 0 !important; padding: 16px 18px 48px !important;
    background: #ffffff; color: #1b1b1f;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
    overflow-x: hidden;
  }
  body * { max-width: 100% !important; box-sizing: border-box; }
  /* A nowrap line clips rather than wraps, hiding the very details the
     student is here to check. Preformatted blocks keep their own rule,
     set below this one. */
  body *:not(pre):not(code) { white-space: normal !important; }
  a { color: #0b5bd3; overflow-wrap: break-word; }
  img { height: auto; }
  table { border-collapse: collapse; width: auto !important; }
  /* break-word, not anywhere: anywhere lets the column shrink below its
     longest word, which chops short labels like "When" in half on a phone. */
  td, th { overflow-wrap: break-word; vertical-align: top; }
  /* Only value cells get the aggressive break. Label cells keep their words
     whole, otherwise "Student" comes out as "Stud / ent" on a phone. */
  td + td, th + td, td:only-child { overflow-wrap: anywhere; }
  p, li, div, span { overflow-wrap: break-word; }
  pre { white-space: pre-wrap; word-break: break-word; font: inherit; margin: 0; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 3px solid #d8d8e0; color: #45454f; }
`;

/* The backend may send a bare fragment or a whole document. A fragment gets
   wrapped; a document gets the rules injected into it, because returning it
   untouched is what let it scroll sideways. */
function emailDocument(html) {
  const source = typeof html === "string" ? html : "";
  const style = `<style>${CONTAIN}</style>`;

  if (!/<!doctype|<html[\s>]/i.test(source)) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${style}
</head><body>${source}</body></html>`;
  }

  // Last in <head> beats the document's own styles on equal specificity,
  // and the !important rules above cover the rest.
  if (/<\/head\s*>/i.test(source)) {
    return source.replace(/<\/head\s*>/i, `${style}</head>`);
  }
  if (/<body[^>]*>/i.test(source)) {
    return source.replace(/(<body[^>]*>)/i, `$1${style}`);
  }
  return style + source;
}

/* Read the status off whatever api.js throws, without assuming its shape. */
function readStatus(error) {
  const raw =
    error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.code;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/* Generic wrappers carry no information a student can act on, so they are
   treated as if there were no message at all. */
const EMPTY_DETAIL = /^(not found|internal server error|bad request|error|request failed\b.*|failed with\b.*)$/i;

function readDetail(error) {
  const candidates = [
    error?.detail,
    error?.body?.detail,
    error?.data?.detail,
    error?.message,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      // FastAPI 422: a list of {loc, msg} objects.
      const joined = candidate
        .map((item) => item?.msg || item?.message)
        .filter(Boolean)
        .join(". ");
      if (joined) return joined;
    }
    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (text && !EMPTY_DETAIL.test(text)) return text;
    }
  }
  return "";
}

/* A failed request should never show a student a raw status line. A 409 or a
   422 carries a real sentence written by the backend, so that one is shown as
   it is. Everything else gets a translation. */
function describeError(error) {
  if (!error) return null;

  const status = readStatus(error);
  const detail = readDetail(error);

  const offline =
    error.offline === true ||
    error.name === "TypeError" ||
    status === 0 ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(
      `${error.message || ""} ${detail}`
    );

  if (offline) {
    return "Couldn't reach the server. Check that the backend is running, then try again.";
  }
  if (status === 409 || status === 422) {
    return detail || "That slot is no longer available. Pick another time.";
  }
  if (status === 404) {
    return "This request has expired. Fill the form again to start a new one.";
  }
  if (status === 410) {
    return "This request is no longer open.";
  }
  if (status === 503) {
    return detail || "Email sending isn't switched on yet, so this can't be sent.";
  }
  if (detail) return detail;
  return "Something went wrong sending this. Try again in a moment.";
}

export default function PreviewCard({
  appointmentId,
  preview,
  onSent,
  onEditDetails,
  onCancelled,
}) {
  const [message, setMessage] = useState(preview?.message ?? "");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(null); // "send" | "cancel" | null
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const headingId = `preview-heading-${appointmentId}`;

  const srcDoc = useMemo(() => emailDocument(preview?.body_html), [preview?.body_html]);
  const edited = message.trim() !== (preview?.message ?? "").trim();
  const remaining = MESSAGE_MAX - message.length;

  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);

  async function send() {
    setBusy("send");
    setError(null);
    try {
      // Matches api.js: confirmAppointment(id, message) — message positional.
      const result = await confirmAppointment(appointmentId, message);
      onSent?.(result);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("cancel");
    setError(null);
    try {
      await cancelAppointment(appointmentId);
    } catch {
      /* The draft is worthless either way: it holds no slot and sends
         nothing. Failing to delete it must not trap the student here. */
    }
    onCancelled?.();
  }

  function editDetails() {
    // Fire and forget: the old draft is replaced by whatever they submit next.
    cancelAppointment(appointmentId).catch(() => {});
    onEditDetails?.();
  }

  const sending = busy === "send";
  const message_error = describeError(error);

  return (
    <section className="preview-card" aria-labelledby={headingId}>
      <header className="preview-head">
        <div>
          <h3 className="preview-title" id={headingId}>Check this before it goes</h3>
          <p className="preview-sub">
            Nothing has been sent yet. This is exactly what{" "}
            <strong>{preview?.to || "the faculty member"}</strong> will receive.
          </p>
        </div>
        <span className="preview-flag">Draft</span>
      </header>

      <dl className="preview-meta">
        <div>
          <dt>To</dt>
          <dd>{preview?.to || "—"}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{preview?.subject || "—"}</dd>
        </div>
      </dl>

      <label className="preview-label" htmlFor={`message-${appointmentId}`}>
        Your message
        <span className="preview-hint">You can reword this</span>
      </label>
      <textarea
        id={`message-${appointmentId}`}
        className="preview-message"
        value={message}
        maxLength={MESSAGE_MAX}
        rows={3}
        disabled={sending}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Add a line about why you'd like to meet…"
      />
      <div className="preview-meter">
        {edited && <span className="preview-edited">Edited</span>}
        {remaining < 150 && (
          <span className={remaining < 0 ? "preview-over" : ""}>
            {remaining} characters left
          </span>
        )}
      </div>

      <div className={`preview-frame ${expanded ? "is-expanded" : ""}`}>
        <iframe
          className="preview-iframe"
          title="Preview of the email that will be sent"
          sandbox=""
          referrerPolicy="no-referrer"
          loading="lazy"
          srcDoc={srcDoc}
        />
        <button
          type="button"
          className="preview-expand"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "Show the whole email"}
        </button>
      </div>

      {message_error && (
        <p className="preview-error" role="alert" tabIndex={-1} ref={errorRef}>
          {message_error}
        </p>
      )}

      <div className="preview-actions">
        <button
          type="button"
          className="preview-btn preview-btn-quiet"
          onClick={editDetails}
          disabled={busy !== null}
        >
          Edit details
        </button>
        <button
          type="button"
          className="preview-btn preview-btn-quiet"
          onClick={discard}
          disabled={busy !== null}
        >
          {busy === "cancel" ? "Discarding…" : "Cancel"}
        </button>
        <button
          type="button"
          className="preview-btn preview-btn-send"
          onClick={send}
          disabled={busy !== null}
        >
          {sending ? (
            <>
              <span className="preview-spinner" aria-hidden="true" />
              Sending…
            </>
          ) : (
            "Confirm and send"
          )}
        </button>
      </div>

      <p className="preview-foot">
        Once sent, {preview?.to ? "they" : "the faculty member"} can accept, decline or
        suggest another time. You'll see the reply here.
      </p>
    </section>
  );
}