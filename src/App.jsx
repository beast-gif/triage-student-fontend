import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  ArrowUp,
  BookOpen,
  GraduationCap,
  Home,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  MessageSquarePlus,
  PanelLeft,
  Trash2,
  Loader2,
  ShieldCheck,
  Link2,
  Gauge,
  ArrowUpRight,
  ExternalLink,
  Sun,
  Moon,
  Copy,
  Check,
  MessageSquareOff,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  MessagesSquare,
  Sparkles,
} from "lucide-react";

import Appointments from "./appointments/Appointments.jsx";
import "./App.css";

// Port 7860 serves BOTH the Gradio UI and the JSON API (gradio_app.py).
// Running `uvicorn app:app` instead gives the API alone on 8000.
const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:7860";

// The conversation id IS the access key — losing it makes the chat
// unreachable, since there is no login to look it up by.
const STORAGE_KEY = "triage_conversation_id";
const THEME_KEY = "triage_theme";

const BAND_LABEL = { high: "HIGH", medium: "MEDIUM", low: "LOW" };

// How long each event holds before the panel moves to the next one.
const AUTOPLAY_MS = 4500;

// How often the student page checks for new or removed events.
const EVENTS_POLL_MS = 30000;

// The four stages POST /chat/stream reports, in order, with the slice of the
// bar each one owns.
//
// The widths are the measured shape of a request, not decoration: retrieval
// and reranking are ~75% of a 30-60s wait, so giving "searching" three
// quarters of the bar is what keeps it moving at a believable rate instead of
// crawling for 40s and then leaping to the end.
//
// `seconds` is a TIME CONSTANT, not a deadline. Within a stage the bar eases
// toward that stage's ceiling as 1 - e^(-elapsed/seconds): ~63% of the way
// there at `seconds`, ~86% at double, never actually arriving. So a slow query
// keeps visibly progressing and a stalled one never claims to have finished.
// Only real stage events advance it to the next segment.
const STAGES = [
  { key: "understanding", label: "Understanding your question",  start: 0.0,  end: 0.05, seconds: 1.5 },
  { key: "searching",     label: "Searching pages and documents", start: 0.05, end: 0.80, seconds: 30 },
  { key: "scoring",       label: "Scoring confidence",            start: 0.80, end: 0.85, seconds: 1 },
  { key: "generating",    label: "Writing the answer",            start: 0.85, end: 0.98, seconds: 4 },
];

const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));

const SUGGESTIONS = [
  "What B.Tech programs are offered?",
  "What is the fee structure of EAC?",
  "Who is the principal?",
];

const TRUST = [
  { icon: ShieldCheck, title: "Official sources only", text: "Answers come from Amrita's own web pages." },
  { icon: Link2, title: "Every answer is cited", text: "Open the source link to check any detail." },
  { icon: Gauge, title: "Confidence shown", text: "When the pages don't cover it, you're told so." },
];

const FEATURES = [
  { icon: BookOpen, title: "Academics", accent: "#8b1538", tint: "#fbf1f4", description: "Courses, departments & curriculum", prompt: "What B.Tech programs are offered?" },
  { icon: GraduationCap, title: "Admissions", accent: "#1f6f78", tint: "#eef6f6", description: "Eligibility, applications & fees", prompt: "What is the eligibility for B.Tech admission?" },
  { icon: Home, title: "Hostel", accent: "#a85d12", tint: "#fcf4ea", description: "Accommodation, facilities & rules", prompt: "What are the hostel facilities in Bengaluru campus?" },
  { icon: BriefcaseBusiness, title: "Placements", accent: "#3b4f9a", tint: "#eff2fa", description: "Companies, careers & placements", prompt: "What is the placement record?" },
  { icon: Building2, title: "Campus", accent: "#3d7a45", tint: "#eff6ef", description: "Facilities, clubs & student life", prompt: "What sports facilities are available?" },
  { icon: CalendarDays, title: "Events & Dates", accent: "#7a3d8c", tint: "#f6f0f8", description: "Exams, events & important dates", prompt: "When does the end semester exam start?" },
];

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // "assistant" (the admissions chatbot) or "desk" (timetable, faculty
  // availability and appointments). Separate views rather than one
  // conversation: they answer from different sources, and only one of
  // them can send an email on a student's behalf.
  const [view, setView] = useState("assistant");

  // Start from the saved choice, else follow the OS setting.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // Private mode — fall through to the OS preference.
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [error, setError] = useState(null);

  const [online, setOnline] = useState(true);

  // Events board. Empty array means "nothing on" — the section hides
  // itself rather than showing a placeholder.
  const [events, setEvents] = useState([]);

  // Which pipeline stage the backend last reported, and how far along the bar
  // has eased within it.
  const [stage, setStage] = useState(null);
  const [progress, setProgress] = useState(0);

  const scrollAnchor = useRef(null);
  const inputRef = useRef(null);
  const chatting = messages.length > 0;

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API}/conversations?limit=40`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {
      // The sidebar is not worth surfacing an error for — the chat still works.
    }
  }, []);

  const openConversation = useCallback(async (id) => {
    try {
      const res = await fetch(`${API}/conversations/${id}`);
      if (res.status === 404) {
        // Expired (30 days inactive) or deleted. Clear the stored id so the
        // next question silently starts a fresh conversation.
        localStorage.removeItem(STORAGE_KEY);
        setConversationId(null);
        setMessages([]);
        return;
      }
      const data = await res.json();
      setConversationId(id);
      setMessages(data.messages ?? []);
      localStorage.setItem(STORAGE_KEY, id);
      setSidebarOpen(false);
    } catch {
      setError("Couldn't load that conversation.");
    }
  }, []);

  // Resume whatever was open last time, and populate the sidebar.
  useEffect(() => {
    loadConversations();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) openConversation(saved);
  }, [loadConversations, openConversation]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Is the backend actually reachable? The status dot says so honestly
  // rather than always claiming to be up.
  useEffect(() => {
    let cancelled = false;

    async function ping() {
      try {
        const res = await fetch(`${API}/conversations?limit=1`);
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    ping();
    const timer = setInterval(ping, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // The board is filled from the admin site, through the API. Events are
  // already filtered and sorted server-side, so an unpublished or finished
  // poster never reaches a student's browser at all.
  //
  // Polled rather than pushed: the board changes a few times a term, and a
  // WebSocket for that would be a lot of moving parts to keep alive for no
  // visible gain. A refetch when the tab regains focus covers the case that
  // actually matters — someone posts an event, then switches to this tab to
  // check it.
  //
  // An empty list — or an unreachable API — means no board: the section is
  // simply not rendered.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function load() {
      try {
        const res = await fetch(`${API}/events`, { cache: "no-store" });
        if (!res.ok) return;
        const list = await res.json();
        if (cancelled || !Array.isArray(list)) return;

        // Only replace state when something actually changed, so the
        // carousel doesn't restart its timer every poll.
        setEvents((prev) =>
          JSON.stringify(prev) === JSON.stringify(list) ? prev : list
        );
      } catch {
        // Backend down or restarting. Keep whatever is on screen and try
        // again on the next tick.
      }
    }

    function start() {
      stop();
      timer = setInterval(load, EVENTS_POLL_MS);
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    // A background tab polling every 30s is wasted work on a laptop
    // battery, and the answer is stale the moment it is read anyway.
    function onVisibility() {
      if (document.hidden) {
        stop();
      } else {
        load();
        start();
      }
    }

    load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", load);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", load);
    };
  }, []);

  // Ctrl/Cmd+K focuses the box, Escape closes the sidebar.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Animate within the current stage. Restarts on every stage event, which is
  // the only thing that moves the bar between segments.
  useEffect(() => {
    if (!stage) return undefined;
    const spec = STAGE_BY_KEY[stage];
    if (!spec) return undefined;

    const startedAt = performance.now();
    const tick = setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const eased = 1 - Math.exp(-elapsed / spec.seconds);
      const next = spec.start + (spec.end - spec.start) * eased;
      // Monotonic. A stage that ends early must not drag the bar backwards to
      // the next stage's start.
      setProgress((prev) => Math.max(prev, next));
    }, 100);

    return () => clearInterval(tick);
  }, [stage]);

  // The attribute drives every colour in App.css.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    // Tints the browser chrome on Android/iOS so the status bar
    // matches the page instead of staying white.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#16131a" : "#f7f5f2";

    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not worth surfacing — the theme still applies for this visit.
    }
  }, [theme]);

  async function send(text) {
    const query = (text ?? input).trim();
    if (!query || busy) return;

    setInput("");
    setError(null);
    setLastQuery(query);
    setBusy(true);
    setProgress(0);
    setStage(null);
    setMessages((prev) => [...prev, { role: "user", content: query }]);

    try {
      const res = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Omitting conversation_id starts a new conversation; the response
        // carries the id to send back on later turns. History is loaded
        // server-side from it, so nothing is uploaded but the id.
        body: JSON.stringify({
          query,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
      });

      if (res.status === 404) {
        localStorage.removeItem(STORAGE_KEY);
        setConversationId(null);
        throw new Error("That conversation expired. Ask again to start a new one.");
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      // EventSource cannot POST, so the stream is read by hand. Frames are
      // separated by a blank line and a network chunk can split anywhere —
      // including mid-frame — so the tail stays in `buffer` until its
      // terminator arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          for (const line of frame.split("\n")) {
            // Anything else is a `:` comment — the keepalive. Ignore it.
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim());

            if (event.type === "stage") setStage(event.stage);
            else if (event.type === "done") data = event.data;
            else if (event.type === "error") throw new Error(event.detail);
          }
        }
      }

      if (!data) throw new Error("The answer stream ended without a reply.");

      setProgress(1);

      if (data.conversation_id && data.conversation_id !== conversationId) {
        setConversationId(data.conversation_id);
        localStorage.setItem(STORAGE_KEY, data.conversation_id);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          meta: {
            band: data.band,
            confidence: data.confidence,
            route: data.route,
            sources: data.sources,
            photos: data.photos,
            llm_called: data.llm_called,
            declined: data.declined,
            model: data.model,
          },
        },
      ]);
      loadConversations();
    } catch (err) {
      setError(err.message);
      // Drop the orphaned question rather than leaving it hanging with no reply.
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setBusy(false);
      setStage(null);
      setProgress(0);
    }
  }

  // Keeps the failed question around so a flaky network costs one click.
  const [lastQuery, setLastQuery] = useState(null);

  function newChat() {
    setMessages([]);
    setConversationId(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
    setSidebarOpen(false);
  }

  async function removeConversation(id, event) {
    event.stopPropagation();
    await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) newChat();
    loadConversations();
  }

  // Which photos each message should show, worked out from the transcript as
  // a whole rather than mutated while rendering. A photo appears ONCE per
  // conversation. Deriving the map keeps the render pure under StrictMode.
  const photosByMessage = (() => {
    const seen = new Set();
    return messages.map((message) => {
      if (message.role !== "assistant") return [];
      const visible = [];
      for (const photo of message.meta?.photos ?? []) {
        if (seen.has(photo.url)) continue;
        seen.add(photo.url);
        visible.push(photo);
      }
      return visible;
    });
  })();

  return (
    <div className="app">
      {/* ================= SIDEBAR ================= */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <span className="sidebar-title">Conversations</span>
          <button className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <PanelLeft size={18} strokeWidth={1.8} />
          </button>
        </div>

        <button className="new-chat" onClick={newChat}>
          <MessageSquarePlus size={17} strokeWidth={1.8} />
          New chat
        </button>

        <div className="conversation-list">
          {conversations.length === 0 && (
            <div className="sidebar-empty">
              <MessageSquareOff size={22} strokeWidth={1.6} />
              <strong>No conversations yet</strong>
              <span>Ask a question and it will be saved here.</span>
            </div>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`conversation-item ${c.id === conversationId ? "active" : ""}`}
              onClick={() => openConversation(c.id)}
            >
              <span className="conversation-preview">
                {c.first_question || "New conversation"}
              </span>
              <span className="conversation-meta">
                {c.message_count} messages
              </span>
              <span
                className="conversation-delete"
                role="button"
                tabIndex={0}
                onClick={(e) => removeConversation(c.id, e)}
                aria-label="Delete conversation"
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </span>
            </button>
          ))}
        </div>

        <p className="sidebar-note">
          Conversations are removed after 30 days of inactivity.
        </p>
      </aside>

      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      {/* ================= HEADER ================= */}
      <div className="top-accent" aria-hidden="true" />
      <header className="header">
        <div className="header-left">
          <button className="history-button" onClick={() => setSidebarOpen(true)} aria-label="Open conversations">
            <PanelLeft size={20} strokeWidth={2} />
            <span>History</span>
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            <Sun className="theme-icon sun" size={20} strokeWidth={2} />
            <Moon className="theme-icon moon" size={20} strokeWidth={2} />
          </button>
          <span className={`live-pill ${online ? "" : "offline"}`}>
            <span className="live-dot" />
            {online ? "Assistant online" : "Assistant unreachable"}
          </span>
        </div>

        <div className="brand">
          <img src="/amrita-logo.svg" alt="Amrita Vishwa Vidyapeetham" className="amrita-logo" />
          <div className="brand-text">
            <span className="brand-name">AMRITA</span>
            <span className="brand-campus">BENGALURU</span>
          </div>
        </div>

        <div className="header-actions">
          <a className="header-link" href="https://www.amrita.edu" target="_blank" rel="noreferrer">
            amrita.edu
            <ExternalLink size={14} strokeWidth={2} />
          </a>
          <button
            className={`view-switch ${view === "desk" ? "on" : ""}`}
            onClick={() => setView(view === "desk" ? "assistant" : "desk")}
            title={
              view === "desk"
                ? "Back to the admissions assistant"
                : "Timetable, faculty availability and appointments"
            }
          >
            {view === "desk" ? (
              <MessagesSquare size={17} strokeWidth={2} />
            ) : (
              <CalendarClock size={17} strokeWidth={2} />
            )}
            <span>{view === "desk" ? "Assistant" : "Faculty desk"}</span>
          </button>

          <button className="header-cta" onClick={newChat}>
            <MessageSquarePlus size={19} strokeWidth={2} />
            <span>New chat</span>
          </button>
          <span className="header-divider" aria-hidden="true" />
          <span className="triage-mark">
            {/* Mark + wordmark come from the image; the tagline is real
                text so it stays crisp at header size. */}
            <img
              src="/triage-logo.png"
              alt="Triage"
              className="triage-logo light"
            />
            <img
              src="/triage-logo-dark.png"
              alt=""
              aria-hidden="true"
              className="triage-logo dark"
            />
            <span className="triage-tag">Intelligence for what matters</span>
          </span>
        </div>
      </header>

      {/* ================= MAIN ================= */}
      <main
        className={`main ${view === "desk" ? "desk-view" : ""} ${
          view === "assistant" && chatting ? "chatting" : ""
        } ${
          view === "assistant" && !chatting && events.length > 0
            ? "has-events"
            : ""
        }`}
      >
        {!chatting && (
          <div className="campus-background">
            {/* Line art is drawn with a CSS mask (public/campus-lines.png),
                so its colour and darkness are set in App.css. */}
            <div className="campus-art" aria-hidden="true" />
          </div>
        )}

        {view === "desk" && <Appointments />}

        {view === "assistant" && !chatting && events.length > 0 && (
          <EventsBoard events={events} />
        )}

        {view === "assistant" && !chatting ? (
          <section className="hero">
            <div className="hero-badge">
              <span className="badge-dot"></span>
              Bengaluru Campus
            </div>

            <h1>
              How can we
              <span> help you?</span>
            </h1>

            <p className="hero-subtitle">
              Find information about academics, admissions, campus life and more.
            </p>

            <SearchBox
              input={input}
              setInput={setInput}
              send={send}
              busy={busy}
              inputRef={inputRef}
              hint
            />
          </section>
        ) : view === "assistant" ? (
          <section className="chat">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div className="bubble user" key={index}>
                  {message.content}
                </div>
              ) : (
                <AssistantMessage
                  key={index}
                  message={message}
                  photos={photosByMessage[index]}
                />
              )
            )}

            {busy && <Progress stage={stage} progress={progress} />}

            {error && (
              <div className="chat-error">
                <span>{error}</span>
                {lastQuery && (
                  <button className="retry-button" onClick={() => send(lastQuery)}>
                    <RefreshCw size={14} strokeWidth={2} />
                    Try again
                  </button>
                )}
              </div>
            )}

            <div ref={scrollAnchor} />
          </section>
        ) : null}

        {view === "assistant" && chatting && (
          <div className="chat-input">
            <SearchBox
              input={input}
              setInput={setInput}
              send={send}
              busy={busy}
              inputRef={inputRef}
            />
          </div>
        )}

        {/* ============ TOPICS + EVENTS, SIDE BY SIDE ============ */}
        {view === "assistant" && !chatting && (
          <div className="landing-columns">
          <section className="quick-section">
            <div className="section-heading">
              <h2>Browse by topic</h2>
            </div>

            <div className="feature-grid">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <button
                    className="feature-card"
                    key={feature.title}
                    style={{ "--accent": feature.accent, "--tint": feature.tint }}
                    onClick={() => send(feature.prompt)}
                  >
                    <div className="feature-icon">
                      <Icon size={24} strokeWidth={1.9} />
                    </div>
                    <div className="feature-content">
                      <h3>{feature.title}</h3>
                      <p>{feature.description}</p>
                    </div>
                    <ArrowUpRight className="feature-arrow" size={19} strokeWidth={2} />
                  </button>
                );
              })}
            </div>

            </section>
          </div>
        )}

        {/* ================= TRUST STRIP ================= */}
        {view === "assistant" && !chatting && (
          <div className="trust-strip">
            {TRUST.map(({ icon: Icon, title, text }) => (
              <div className="trust-item" key={title}>
                <Icon size={20} strokeWidth={1.9} />
                <div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ================= FOOTER ================= */}
      {view === "assistant" && !chatting && (
        <footer className="footer">
          <span>Amrita School of Engineering</span>
          <span className="footer-dot">•</span>
          <span>Bengaluru Campus</span>
        </footer>
      )}
    </div>
  );
}

/* =========================================================
   EVENTS BOARD

   Posters and links for what's happening on campus, read from
   public/events.json. Horizontal rail rather than a grid: the
   list is short and changes often, and a rail doesn't push the
   topic cards down the page when three events become eight.
========================================================= */

// "2026-10-04" -> "Sat, 4 Oct". Undated entries just show nothing.
function formatDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// "17:00" -> "5 pm", "09:30" -> "9.30 am". Nothing fancy: these are read
// at a glance on a poster card, so the shortest correct form wins.
function formatTime(value) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}.${String(m).padStart(2, "0")} ${suffix}`;
}

function EventsBoard({ events }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = events.length;
  const current = events[Math.min(index, count - 1)];

  // Auto-advance. Pauses while the pointer is over the panel or a
  // control has focus, so it never moves out from under someone who
  // is reading it or tabbing through.
  useEffect(() => {
    if (count < 2 || paused) return undefined;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [count, paused]);

  // A shorter list after an event expires must not leave the index
  // pointing past the end.
  useEffect(() => {
    setIndex((prev) => (prev >= count ? 0 : prev));
  }, [count]);

  function go(next) {
    setIndex(((next % count) + count) % count);
  }

  const when = formatDate(current.date);

  // "9.30 am – 5 pm", or just the start if there is no end.
  const start = formatTime(current.startTime);
  const finish = formatTime(current.endTime);
  const timing = start ? (finish ? `${start} – ${finish}` : start) : null;

  const Tag = current.url ? "a" : "div";
  const linkProps = current.url
    ? { href: current.url, target: "_blank", rel: "noreferrer" }
    : {};

  return (
    <aside
      className="events-panel"
      aria-label="Campus events"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="events-panel-head">
        <span className="events-title">
          <Sparkles size={14} strokeWidth={2} />
          What&apos;s on
        </span>

        {count > 1 && (
          <div className="events-controls">
            <button onClick={() => go(index - 1)} aria-label="Previous event">
              <ChevronLeft size={16} strokeWidth={2.2} />
            </button>
            <span className="events-count">
              {index + 1}/{count}
            </span>
            <button onClick={() => go(index + 1)} aria-label="Next event">
              <ChevronRight size={16} strokeWidth={2.2} />
            </button>
          </div>
        )}
      </div>

      <div className="events-stage">
        {/* Keyed on the event id so React remounts on every change and
            the entry animation replays. */}
        <Tag className="event-card" key={current.id ?? index} {...linkProps}>
          {current.poster ? (
            <img
              className="event-poster"
              src={
                current.poster.startsWith("/")
                  ? `${API}${current.poster}`
                  : current.poster
              }
              alt={current.title}
              loading="lazy"
            />
          ) : (
            <div className="event-poster placeholder" aria-hidden="true">
              <CalendarClock size={32} strokeWidth={1.6} />
            </div>
          )}

          <div className="event-body">
            {current.tag && <span className="event-tag">{current.tag}</span>}
            <h3>{current.title}</h3>
            {(when || timing || current.venue) && (
              <p className="event-meta">
                {[when, timing, current.venue].filter(Boolean).join(" · ")}
              </p>
            )}
            {current.url && (
              <span className="event-link">
                Details
                <ArrowUpRight size={14} strokeWidth={2} />
              </span>
            )}
          </div>
        </Tag>
      </div>

      {count > 1 && (
        <div className="events-dots" role="tablist">
          {events.map((event, i) => (
            <button
              key={event.id ?? i}
              className={i === index ? "dot active" : "dot"}
              onClick={() => go(i)}
              role="tab"
              aria-selected={i === index}
              aria-label={`Show ${event.title}`}
            >
              {/* Fills over the autoplay interval, so the wait is
                  visible rather than a surprise. */}
              <span
                className="dot-fill"
                style={
                  i === index && !paused
                    ? { animationDuration: `${AUTOPLAY_MS}ms` }
                    : undefined
                }
              />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function SearchBox({ input, setInput, send, busy, hint, inputRef }) {
  return (
    <div className="search-wrapper">
      <div className={`search-glow ${busy ? "busy" : ""}`}>
      <div className="search-box">
        <Search className="search-icon" size={23} strokeWidth={2} />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Search or ask anything..."
          aria-label="Search or ask anything"
          disabled={busy}
        />
        <kbd className="shortcut-hint" aria-hidden="true">
          {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"} K
        </kbd>
        <button
          className="search-button"
          onClick={() => send()}
          disabled={busy || !input.trim()}
          aria-label="Search"
        >
          {busy ? (
            <Loader2 className="spin" size={20} strokeWidth={2} />
          ) : (
            <ArrowUp size={20} strokeWidth={2} />
          )}
        </button>
      </div>
      </div>

      {hint && (
        <div className="suggestions">
          <span className="suggestions-label">Try asking</span>
          {SUGGESTIONS.map((q) => (
            <button key={q} className="suggestion" onClick={() => send(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   MARKDOWN

   The model returns Markdown, which used to render as literal
   "**bold**" and "1." inside a pre-wrap paragraph. This is a
   deliberately small subset — headings, lists, bold, italic,
   inline code and links — rather than a dependency, since that
   is all the answers ever contain.
========================================================= */

// Inline spans: `code`, **bold**, *italic*, [text](url), bare URLs.
function renderInline(text, keyPrefix = "i") {
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g;

  const nodes = [];
  let last = 0;
  let match;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      nodes.push(
        <a key={key} href={match[5]} target="_blank" rel="noreferrer">
          {label}
        </a>
      );
    } else if (token.startsWith("http")) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer">
          {token.replace(/^https?:\/\//, "")}
        </a>
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Block level: headings, bullet lists, numbered lists, paragraphs.
function Markdown({ text }) {
  const lines = (text ?? "").split("\n");
  const blocks = [];
  let list = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className="md-list">
        {list.items.map((item, i) => (
          <li key={i}>{renderInline(item, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flush();
      return;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);
      const Tag = `h${level}`;
      blocks.push(
        <Tag key={`h${index}`} className="md-heading">
          {renderInline(heading[2], `h${index}`)}
        </Tag>
      );
      return;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
      return;
    }

    flush();
    blocks.push(
      <p key={`p${index}`} className="md-p">
        {renderInline(line, `p${index}`)}
      </p>
    );
  });

  flush();
  return <div className="markdown">{blocks}</div>;
}

/* =========================================================
   PROGRESS

   Replaces the static "Searching the admissions pages…" line.
   The stages are real backend events; only the motion WITHIN a
   stage is estimated, and it is estimated in a way that can
   never overrun — see STAGES above.

   Keeps the existing `thinking` class so it inherits every
   treatment App.css already gives that bubble in BOTH themes —
   surface colour, border, blur, muted text. `progress-bubble`
   only re-stacks it into a column, since `.thinking` lays out
   as a centred row.
========================================================= */
function Progress({ stage, progress }) {
  const spec = STAGE_BY_KEY[stage];
  // Before the first event lands there is nothing honest to name yet, so the
  // label says only that the request is on its way.
  const label = spec ? spec.label : "Sending your question";
  const index = spec ? STAGES.findIndex((s) => s.key === stage) + 1 : 0;

  return (
    <div className="bubble assistant thinking progress-bubble">
      <div className="progress-row">
        <Loader2 className="spin" size={16} strokeWidth={2} />
        <span className="progress-label">{label}…</span>
        {index > 0 && (
          <span className="progress-step">
            {index}/{STAGES.length}
          </span>
        )}
      </div>

      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="progress-fill"
          style={{ width: `${Math.min(progress, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

// Copies the answer text, and says so for two seconds.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission) — the
      // user can still select the text by hand.
    }
  }

  return (
    <button
      className={`copy-button ${copied ? "copied" : ""}`}
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy answer"}
      title={copied ? "Copied" : "Copy answer"}
    >
      {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={2} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function AssistantMessage({ message, photos = [] }) {
  const meta = message.meta ?? {};
  const band = meta.band ?? "low";

  let cost;
  if (!meta.llm_called) cost = "LLM skipped — no cost incurred";
  else if (meta.declined) cost = "no answer found in the sources";
  else cost = `generated by ${(meta.model ?? "").split("/").pop()}`;

  return (
    <div className="bubble assistant">
      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((p) => (
            <figure className="photo" key={p.url}>
              <img src={p.url} alt={p.name} loading="lazy" />
              <figcaption>{p.name}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="answer">
        <Markdown text={message.content} />
      </div>

      {(meta.sources?.length ?? 0) > 0 && (
        <div className="sources">
          <span className="sources-label">Sources</span>
          <ul>
            {meta.sources.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url.replace(/^https?:\/\//, "").slice(0, 70)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Always shown, including on refusals — "LOW · LLM skipped" is the
          behaviour this project exists to demonstrate. */}
      <div className="badge-row">
        <span className={`band ${band}`}>
          {BAND_LABEL[band]} {Number(meta.confidence ?? 0).toFixed(2)}
        </span>
        <span className="badge-sep">·</span>
        <span>{meta.route || "plain search"}</span>
        <span className="badge-sep">·</span>
        <span>{cost}</span>
        <CopyButton text={message.content} />
      </div>
    </div>
  );
}

export default App;