import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./splash.css";

/**
 * The intro that plays before the portal appears.
 *
 * Three rules it follows, because an intro that breaks any of them stops
 * being a flourish and becomes a toll gate:
 *
 *   once per session   — sessionStorage, so a reload mid-task does not
 *                        make you sit through it again
 *   always skippable   — any click, tap or key ends it immediately
 *   never for everyone — prefers-reduced-motion skips it outright
 *
 * It renders into <body> so it sits above the portal's own fixed header
 * and composer, whatever their z-index.
 */

/* The T mark, served from public/. Set this to whatever the header
   already uses — the header is the one place that definitely knows the
   name. If the file is missing the image fails quietly and the wordmark
   keeps its accent dot instead, so a wrong name costs nothing. */
const MARK_SRC = "/triage-mark-dark.png";

const SEEN_KEY = "triage_splash_seen";

/* The only pacing knob. Every duration and delay in splash.css multiplies
   by it, along with the two holds below, so the CSS and the JS can never
   drift apart. 1 is brisk, 1.7 is the slow-motion setting, past about 2.2
   the skyline wipe and the wordmark stop overlapping and it reads as two
   separate animations rather than one. */
const SPEED = 1.7;

const HOLD_MS = 3100 * SPEED;   // when the exit starts
const EXIT_MS = 680 * SPEED;    // how long the exit takes

function alreadySeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private mode or blocked storage: play it, it is only a second.
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do — worst case it plays again next navigation.
  }
}

export default function Splash() {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Decided once, before the first paint, so the overlay never flashes
  // in for someone who should not see it.
  const [phase, setPhase] = useState(() =>
    reduced || alreadySeen() ? "done" : "playing"
  );

  // The mark leads the sequence, so the wordmark's own accent dot is only
  // a stand-in for when there is no mark to show.
  const [hasMark, setHasMark] = useState(true);

  const timers = useRef([]);

  const finish = useCallback(() => {
    setPhase((current) => (current === "playing" ? "leaving" : current));
  }, []);

  useEffect(() => {
    if (phase !== "playing") return undefined;

    markSeen();
    timers.current.push(setTimeout(finish, HOLD_MS));

    // Any input at all ends it. Waiting out an animation you have seen
    // before is the most irritating thing a site can ask of you.
    const skip = () => finish();
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("wheel", skip);
    };
  }, [phase, finish]);

  useEffect(() => {
    if (phase !== "leaving") return undefined;
    const timer = setTimeout(() => setPhase("done"), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Hold the scroll still while it plays, then give it back exactly as it
  // was. Locking the wrapper rather than the body is what broke scrolling
  // on phones last time, so this only touches body.overflow.
  useEffect(() => {
    if (phase === "done") return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [phase]);

  if (phase === "done") return null;

  const overlay = (
    <div
      className={`sp ${phase === "leaving" ? "is-leaving" : ""}`}
      style={{ "--sp-speed": SPEED }}
      role="presentation"
      aria-hidden="true"
    >
      <div className="sp-art" />

      <div className="sp-centre">
        {hasMark && (
          <img
            className="sp-mark"
            src={MARK_SRC}
            alt=""
            onError={() => setHasMark(false)}
          />
        )}

        <h1 className="sp-word">
          TRIAGE
          {!hasMark && <span className="sp-dot" />}
        </h1>
        <span className="sp-rule" />
        <p className="sp-tag">Intelligence for what matters</p>
      </div>

      <p className="sp-skip">Tap to skip</p>
    </div>
  );

  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}