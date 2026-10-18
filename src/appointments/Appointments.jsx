import { useEffect, useRef, useState } from "react";
import { CalendarClock, Loader2, Send, AlertTriangle } from "lucide-react";

import { postChat, ApiError, isMockMode } from "./api.js";
import { AvailabilityCard, TimetableCard } from "./cards.jsx";
import BookingForm from "./BookingForm.jsx";
import PreviewCard from "./PreviewCard.jsx";
import StatusCard from "./StatusCard.jsx";
import MyAppointments from "./MyAppointments.jsx";
import "./appointments.css";

/**
 * The faculty desk: a separate conversation from the admissions
 * assistant, with its own history.
 *
 * Kept apart deliberately. The two answer different questions from
 * different sources — one reads scraped web pages, this one reads the
 * timetable and can send email on a student's behalf — and mixing them
 * would make it unclear which one is about to do something.
 *
 * Steps 1-6 render text, timetable, availability, the booking form, the
 * email preview and the request's status. Unknown types fall back to a
 * readable notice rather than an empty bubble.
 */

const SUGGESTIONS = [
  "Timetable for Tuesday",
  "Is Bhavana free Monday at 11?",
  "Is Bhavana free Monday at 10?",
  "Tuesday 12 Deepthi",
];

/**
 * Entries are addressed by a stable key rather than by array position.
 *
 * Position looks equivalent and is not: cancelling a booking removes an
 * entry, so every later index shifts by one. React would then reuse a
 * mounted component for a different entry, and the preview card holds
 * editable text — the student would see someone else's draft message in
 * their own card. A counter costs one line and the whole class of bug
 * goes away.
 */
let nextKey = 1;
const keyed = (entry) => ({ key: nextKey++, ...entry });

export default function Appointments() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState(null);
  const [showAppointments, setShowAppointments] = useState(false);

  const anchor = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    anchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text) {
    const query = (text ?? input).trim();
    if (!query || busy) return;

    setInput("");
    setError(null);
    setLastQuery(query);
    setBusy(true);
    setMessages((prev) => [...prev, keyed({ role: "student", content: query })]);

    try {
      const data = await postChat(query);
      const replies = Array.isArray(data.messages) ? data.messages : [];
      setMessages((prev) => [
        ...prev,
        ...replies.map((message) => keyed({ role: "assistant", message })),
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Something went wrong."
      );
      // Drop the question rather than leaving it sitting there unanswered.
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  /**
   * A Book click appends a card to the thread rather than opening a
   * modal: the request stays in sequence with the question that led to
   * it, and scrolling back shows how the student got there.
   */
  function startBooking(slot) {
    setMessages((prev) => [...prev, keyed({ role: "booking", slot })]);
  }

  function cancelBooking(key) {
    setMessages((prev) => prev.filter((entry) => entry.key !== key));
  }

  /** The draft exists on the server; swap the form for its preview. */
  function attachDraft(key, draft) {
    setMessages((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, draft } : entry))
    );
  }

  /** Back to the form, same slot. Its fields repopulate from storage. */
  function detachDraft(key) {
    setMessages((prev) =>
      prev.map((entry) =>
        entry.key === key ? { ...entry, draft: undefined } : entry
      )
    );
  }

  /**
   * Sent. The booking entry becomes an ordinary assistant message so the
   * thread reads as one sequence, and so the status card is reached by
   * the same switch as everything else.
   *
   * The type is forced rather than trusted: confirm returns the status
   * body, and whether it carries a discriminator is the backend's
   * business, not something the thread should depend on.
   */
  function markSent(key, status) {
    setMessages((prev) =>
      prev.map((entry) =>
        entry.key === key
          ? {
              key,
              role: "assistant",
              message: { ...status, type: "booking_status" },
            }
          : entry
      )
    );
  }

  const started = messages.length > 0;

  return (
    <section className="desk">
      {isMockMode && (
        <p className="desk-mock" role="status">
          Demo data — the appointments backend isn&apos;t connected yet.
        </p>
      )}

      <div className="desk-bar">
        <button
          type="button"
          className="desk-mine"
          onClick={() => setShowAppointments(true)}
        >
          My appointments
        </button>
      </div>

      {!started && (
        <div className="desk-intro">
          <span className="desk-icon">
            <CalendarClock size={26} strokeWidth={1.7} />
          </span>
          <h2>Faculty desk</h2>
          <p>
            Check the class timetable, see whether a faculty member is free,
            and request an appointment. Nothing is emailed until you review
            it and confirm.
          </p>

          <div className="desk-suggestions">
            {SUGGESTIONS.map((text) => (
              <button key={text} onClick={() => send(text)} disabled={busy}>
                {text}
              </button>
            ))}
          </div>
        </div>
      )}

      {started && (
        <div className="desk-thread">
          {messages.map((entry) =>
            entry.role === "student" ? (
              <div className="desk-bubble student" key={entry.key}>
                {entry.content}
              </div>
            ) : entry.role === "booking" ? (
              entry.draft ? (
                <PreviewCard
                  key={entry.key}
                  appointmentId={entry.draft.appointment_id}
                  preview={entry.draft.preview}
                  onSent={(status) => markSent(entry.key, status)}
                  onEditDetails={() => detachDraft(entry.key)}
                  onCancelled={() => cancelBooking(entry.key)}
                />
              ) : (
                <BookingForm
                  key={entry.key}
                  slot={entry.slot}
                  onCreated={(draft) => attachDraft(entry.key, draft)}
                  onCancel={() => cancelBooking(entry.key)}
                />
              )
            ) : (
              <MessageCard
                key={entry.key}
                message={entry.message}
                onBook={startBooking}
              />
            )
          )}

          {busy && (
            <div className="desk-bubble assistant thinking">
              <Loader2 className="spin" size={15} strokeWidth={2} />
              Checking the timetable…
            </div>
          )}

          {error && (
            <div className="desk-error" role="alert">
              <AlertTriangle size={16} strokeWidth={2} />
              <span>{error}</span>
              {lastQuery && (
                <button onClick={() => send(lastQuery)}>Try again</button>
              )}
            </div>
          )}

          <div ref={anchor} />
        </div>
      )}

      <div className="desk-composer">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about the timetable, or whether someone is free…"
          aria-label="Ask about the timetable or faculty availability"
          disabled={busy}
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          {busy ? (
            <Loader2 className="spin" size={18} strokeWidth={2} />
          ) : (
            <Send size={18} strokeWidth={2} />
          )}
        </button>
      </div>

      {showAppointments && (
        <MyAppointments onClose={() => setShowAppointments(false)} />
      )}
    </section>
  );
}

/* ============================================================
   MESSAGE TYPES

   One switch, so an unknown type from a newer backend degrades to a
   notice instead of rendering nothing at all.
============================================================ */

function MessageCard({ message, onBook }) {
  switch (message?.type) {
    case "text":
      return (
        <div className="desk-bubble assistant">
          <Text content={message.content} />
        </div>
      );

    case "timetable":
      return <TimetableCard message={message} />;

    case "availability_result":
      return <AvailabilityCard message={message} onBook={onBook} />;

    case "booking_status":
      return <StatusCard message={message} />;

    default:
      return (
        <div className="desk-bubble assistant pending-type">
          Unrecognised reply from the server.
        </div>
      );
  }
}

/**
 * The small subset of markdown these replies actually use: bold,
 * italic, and dash bullets. Anything heavier can come later — it would
 * be dead code today.
 */
function Text({ content }) {
  const lines = String(content ?? "").split("\n");
  const blocks = [];
  let list = null;

  const flush = () => {
    if (!list) return;
    blocks.push(
      <ul key={`l${blocks.length}`}>
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      list = list ?? [];
      list.push(bullet[1]);
      return;
    }
    flush();
    blocks.push(<p key={`p${index}`}>{inline(line)}</p>);
  });

  flush();
  return <>{blocks}</>;
}

function inline(text) {
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let match;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    nodes.push(
      token.startsWith("**") ? (
        <strong key={n++}>{token.slice(2, -2)}</strong>
      ) : (
        <em key={n++}>{token.slice(1, -1)}</em>
      )
    );
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}