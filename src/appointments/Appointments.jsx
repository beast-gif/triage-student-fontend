import { useEffect, useRef, useState } from "react";
import { Loader2, Send, AlertTriangle } from "lucide-react";

import { postChat, ApiError, isMockMode } from "./api.js";
import { AvailabilityCard, TimetableCard } from "./cards.jsx";
import BookingForm from "./BookingForm.jsx";
import PreviewCard from "./PreviewCard.jsx";
import StatusCard from "./StatusCard.jsx";
import MyAppointments from "./MyAppointments.jsx";
import "./appointments.css";
import "./desk-intro.css";

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

/**
 * Three examples, each a different kind of question.
 *
 * There were four before, but two of them were the same question an hour
 * apart ("…at 11?" / "…at 10?"), which taught the student nothing the
 * first one hadn't and left the fourth wrapping onto a row by itself. The
 * queries are the ones that already work; only the duplicate is gone and
 * each now carries the shape it demonstrates.
 *
 * The third looks like debug shorthand because it is — the parser takes
 * a bare day, hour and name. That is worth advertising rather than
 * hiding: nobody would guess it, and it is faster than a sentence.
 */
const EXAMPLES = [
  { query: "Timetable for Tuesday", role: "a whole day", span: "day" },
  { query: "Is Bhavana free Monday at 11?", role: "one person, one time", span: "slot" },
  { query: "Tuesday 12 Deepthi", role: "the same, typed faster", span: "slot" },
];

/**
 * The miniature beside each example: the same week, with the part that
 * query covers drawn as an outline — a whole column for a day, a single
 * cell for one person at one time.
 *
 * Rows two and three share a glyph deliberately. They ask the same
 * question, one as a sentence and one as shorthand, and saying so with
 * the picture is worth more than three icons that differ only so that
 * every row can have its own.
 */
function Glyph({ span }) {
  const cells = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      cells.push(
        <rect
          key={`${column}-${row}`}
          className="di-g-cell"
          x={column * 6.5}
          y={row * 6}
          width="4"
          height="3.5"
          rx="1"
        />
      );
    }
  }

  return (
    <svg className="di-glyph" viewBox="0 0 23.5 15.5" aria-hidden="true">
      {cells}
      {span === "day" ? (
        <rect className="di-g-mark" x="5.8" y="-0.8" width="5.4" height="17.1" rx="1.8" />
      ) : (
        <rect className="di-g-mark" x="5.9" y="5.4" width="5.2" height="4.7" rx="1.5" />
      )}
    </svg>
  );
}

/**
 * The mark: a week with one slot open.
 *
 * A calendar glyph would sit just as happily on a reminder app or a
 * to-do list. This is the object the desk actually reads — five days of
 * blocks — and the free slot is drawn as an outline rather than a fill,
 * because what the student is hunting for is a gap, not a thing.
 */
function WeekMark() {
  const busy = "di-cell-busy";
  const gap = "di-cell-gap";
  const week = [
    [busy, busy, gap, busy],
    [busy, gap, busy, busy],
    [busy, "free", busy, gap],
    [gap, busy, busy, busy],
    [busy, busy, gap, busy],
  ];

  return (
    <svg
      className="di-week"
      viewBox="0 0 91 44"
      role="img"
      aria-label="A week of classes with one free slot"
    >
      {week.map((day, column) =>
        day.map((cell, row) =>
          cell === "free" ? (
            <rect
              key={`${column}-${row}`}
              className="di-cell-free"
              x={column * 20 + 0.75}
              y={row * 12 + 0.75}
              width="9.5"
              height="6.5"
              rx="1.5"
            />
          ) : (
            <rect
              key={`${column}-${row}`}
              className={cell}
              x={column * 20}
              y={row * 12}
              width="11"
              height="8"
              rx="1.5"
            />
          )
        )
      )}
    </svg>
  );
}

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

  /* The panel reads its own ids out of storage and does its own polling,
     so all this has to do is mount and unmount it. */
  const [mineOpen, setMineOpen] = useState(false);

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

      {/* Outside both branches on purpose: a student who has just asked a
          question still needs a way back to what they have already booked,
          and tucking this inside the empty state makes it disappear the
          moment the thread starts. Ordinary flow rather than an absolute
          corner, so it cannot depend on `.desk` having a position. */}
      <div className="desk-topbar">
        <button
          type="button"
          className="desk-mine"
          onClick={() => setMineOpen(true)}
        >
          My appointments
        </button>
      </div>

      {mineOpen && <MyAppointments onClose={() => setMineOpen(false)} />}

      {!started && (
        <div className="di">
          <WeekMark />

          <h2 className="di-title">Faculty desk</h2>
          <p className="di-lede">
            Check the timetable, find a free slot, ask for a time.
          </p>

          <ul className="di-examples">
            {EXAMPLES.map((example) => (
              <li className="di-example" key={example.query}>
                <button
                  className="di-try"
                  onClick={() => send(example.query)}
                  disabled={busy}
                >
                  <Glyph span={example.span} />
                  <span className="di-text">
                    <span className="di-query">{example.query}</span>
                    <span className="di-role">{example.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Split out of the opening paragraph. Up there it was the tail
              of a third centred line; here it answers the question the
              student actually has, directly above the box they type in. */}
          <p className="di-promise">
            Nothing is emailed until you&apos;ve read it and confirmed.
          </p>
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