/**
 * Every backend call for the faculty-appointments feature.
 *
 * One module, so the rest of the feature never touches fetch directly and
 * the whole thing can run against mocks while the backend is being built.
 *
 * Types are documented as JSDoc rather than TypeScript to match the rest
 * of this app. They are what the backend contract promises — see the
 * spec — and editors will still autocomplete from them.
 *
 * @typedef {Object} TextMessage
 * @property {"text"} type
 * @property {string} content                      markdown
 *
 * @typedef {Object} TimetableEntry
 * @property {string} day
 * @property {string} start                        "08:10"
 * @property {string} end
 * @property {"lecture"|"lab"|"activity"} kind
 * @property {{code: string, title: string, faculty: string[], rooms: string[]}[]} courses
 * @property {string} [activity]                   only when kind = "activity"
 * @property {string} [note]
 *
 * @typedef {Object} TimetableMessage
 * @property {"timetable"} type
 * @property {string} day
 * @property {string|null} faculty
 * @property {{program: string, semester: number, default_room: string}} section
 * @property {TimetableEntry[]} entries
 *
 * @typedef {Object} AvailabilityMessage
 * @property {"availability_result"} type
 * @property {string} faculty
 * @property {number} faculty_id
 * @property {string} date
 * @property {string} day
 * @property {string} time
 * @property {number} duration_min
 * @property {"free"|"busy"|"maybe"|"break"|"outside_hours"} status
 * @property {string} reason
 * @property {boolean} bookable
 * @property {{start: string, end: string}[]} alternatives
 *
 * @typedef {Object} BookingStatusMessage
 * @property {"booking_status"} type
 * @property {number} appointment_id
 * @property {"pending"|"rescheduled"|"accepted"|"declined"|"cancelled"|"expired"} status
 * @property {string} faculty
 * @property {string} slot                         ISO with offset
 * @property {string|null} proposed_slot
 * @property {string|null} faculty_note
 *
 * @typedef {TextMessage|TimetableMessage|AvailabilityMessage|BookingStatusMessage} Message
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:7860";
const USE_MOCK = String(import.meta.env.VITE_USE_MOCK_API) === "true";

// Every path below is relative to the DESK router, which app.py mounts
// alongside the admissions API on the same host and port:
//
//     app.include_router(desk.router)      # routes.py declares prefix="/desk"
//
// Written once, here, rather than spelled into each path — because getting
// it wrong does not 404. The admissions endpoint is POST /chat and its
// request model is
//
//     class ChatRequest(BaseModel):
//         query: str
//         conversation_id: str | None = None
//
// which is byte-for-byte what postChat() sends. A missing prefix therefore
// VALIDATES: FastAPI accepts the body, runs the full RAG pipeline over the
// admissions corpus — embedding, reranking, scoring, ~80s — and returns
// 200 OK with {answer, band, confidence, sources}. This module reads
// body.messages, gets undefined, and the spinner never resolves. No error
// anywhere, at any layer. One constant is cheaper than finding that twice.
const PREFIX = "/desk";

/** Thrown for any non-2xx, carrying the status so callers can act on 409/410. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${PREFIX}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      ...options,
    });
  } catch {
    // Distinguishing "server said no" from "never reached the server"
    // matters: only the second is worth a retry button.
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.detail || `Request failed (${res.status})`, res.status);
  }
  return body;
}

/* ============================================================
   REAL ENDPOINTS
============================================================ */

/**
 * Ask the assistant something. Returns a list of messages to render,
 * which is what lets one reply mix prose with a timetable or an
 * availability card.
 * @returns {Promise<{messages: Message[]}>}
 */
export async function postChat(query, conversationId) {
  if (USE_MOCK) return mock.chat(query);

  const body = await request("/chat", {
    method: "POST",
    body: JSON.stringify({
      query,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });

  // The one response in this module whose shape is worth asserting. A 200
  // carrying the wrong body is the failure mode this endpoint actually has
  // — see the PREFIX comment — and it is invisible without this: the UI
  // just sits on its spinner forever while the network tab shows success.
  // Better a visible error naming the cause than a hang with no cause.
  if (!Array.isArray(body?.messages)) {
    throw new ApiError(
      "The server replied, but not with a desk answer. Check that the " +
        "request went to /desk/chat and not the admissions /chat.",
      200
    );
  }
  return body;
}

/** Create a DRAFT. Nothing is emailed until confirm(). */
export function createAppointment(payload) {
  if (USE_MOCK) return mock.createAppointment(payload);
  return request("/appointments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** The student has read the preview and approved it — this sends the email. */
export function confirmAppointment(id, message) {
  if (USE_MOCK) return mock.confirmAppointment(id, message);
  return request(`/appointments/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/**
 * Cancel, or discard an unsent draft.
 *
 * A sent request needs a reason, which is forwarded to the faculty member;
 * a draft has nobody to tell, so the body is omitted entirely rather than
 * sent as {reason: undefined}, which would serialise to {}.
 */
export function cancelAppointment(id, reason) {
  if (USE_MOCK) return mock.cancelAppointment(id, reason);
  return request(`/appointments/${id}/cancel`, {
    method: "POST",
    ...(reason ? { body: JSON.stringify({ reason }) } : {}),
  });
}

/** Everything this browser has booked, in one round trip. Unknown ids are skipped. */
export function lookupAppointments(ids) {
  if (USE_MOCK) return mock.lookupAppointments(ids);
  return request("/appointments/lookup", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

/** Answer a time the faculty member suggested, from inside the app. */
export function answerProposal(id, action) {
  if (USE_MOCK) return mock.answerProposal(id, action);
  return request(`/appointments/${id}/proposal`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/** Polled while a request is pending or rescheduled. */
export function getAppointmentStatus(id) {
  if (USE_MOCK) return mock.getStatus(id);
  return request(`/appointments/${id}/status`);
}

/* ---- faculty response page ---- */

/** Read-only. Opening the email link must never change anything. */
export function getRespondRequest(id, token) {
  if (USE_MOCK) return mock.getRespond(id, token);
  return request(`/appointments/${id}/respond?token=${encodeURIComponent(token)}`);
}

export function submitResponse(id, payload) {
  if (USE_MOCK) return mock.submitResponse(id, payload);
  return request(`/appointments/${id}/respond`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ---- student reschedule page ---- */

export function getStudentResponse(id, token) {
  if (USE_MOCK) return mock.getStudentResponse(id, token);
  return request(
    `/appointments/${id}/student-response?token=${encodeURIComponent(token)}`
  );
}

export function submitStudentResponse(id, payload) {
  if (USE_MOCK) return mock.submitStudentResponse(id, payload);
  return request(`/appointments/${id}/student-response`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export const isMockMode = USE_MOCK;

/* ============================================================
   MOCKS

   VITE_USE_MOCK_API=true. Realistic shapes with a 500ms delay, so the
   whole flow can be clicked through before the backend exists — and so
   the loading states get exercised rather than flashing past.
============================================================ */

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";

const delay = (value, ms = 500) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Poll counts per appointment, so status can walk pending -> accepted.
const pollCounts = new Map();

const mock = {
  chat(query) {
    const q = query.toLowerCase();

    if (q.includes("timetable") || q.includes("classes")) {
      return delay({ messages: [mockTimetable()] });
    }

    if (q.includes("free") || q.includes("available") || q.includes("busy")) {
      if (q.includes("deepthi")) return delay({ messages: [mockMaybe()] });
      if (q.includes("11")) return delay({ messages: [mockFree()] });
      return delay({ messages: [mockBusy()] });
    }

    // "tuesday 12 deepthi" — a bare name and time, no question word
    if (q.includes("deepthi")) return delay({ messages: [mockMaybe()] });

    return delay({
      messages: [
        {
          type: "text",
          content:
            "I can help with **class timetables** and **faculty availability**.\n\n" +
            "Try:\n" +
            "- *timetable tuesday*\n" +
            "- *is Bhavana free Monday at 11?*\n" +
            "- *tuesday 12 deepthi*",
        },
      ],
    });
  },

  createAppointment(payload) {
    const id = 55;
    pollCounts.set(id, 0);
    return delay({
      appointment_id: id,
      status: "draft",
      preview: {
        subject: `Appointment request — ${payload.student.name} (${payload.student.roll_no})`,
        to: "bhavana.v@blr.amrita.edu",
        body_html: `
          <div style="font-family: system-ui, sans-serif; line-height: 1.6; color: #222;">
            <p>Dear Dr. Bhavana V,</p>
            <p>
              <strong>${payload.student.name}</strong> (${payload.student.roll_no},
              ${payload.student.branch}, semester ${payload.student.semester})
              has requested an appointment.
            </p>
            <table style="border-collapse: collapse; margin: 14px 0;">
              <tr><td style="padding: 3px 14px 3px 0; color: #666;">When</td>
                  <td><strong>${payload.date} at ${payload.time}</strong>
                  (${payload.duration_min} minutes)</td></tr>
              <tr><td style="padding: 3px 14px 3px 0; color: #666;">Purpose</td>
                  <td>${payload.purpose}</td></tr>
              <tr><td style="padding: 3px 14px 3px 0; color: #666;">Email</td>
                  <td>${payload.student.email}</td></tr>
            </table>
            <p style="margin: 18px 0;">
              <a href="#" style="background:#8b1538;color:#fff;padding:9px 16px;
                 border-radius:6px;text-decoration:none;">Accept</a>
              &nbsp;
              <a href="#" style="color:#8b1538;">Decline</a>
              &nbsp;·&nbsp;
              <a href="#" style="color:#8b1538;">Propose another time</a>
            </p>
            <p style="color:#888;font-size:13px;">
              This request expires in 24 hours.
            </p>
          </div>`,
        message:
          `Good morning ma'am, I would like to meet you regarding ` +
          `${payload.purpose.toLowerCase()}. Please let me know if this time works.`,
      },
    });
  },

  confirmAppointment(id) {
    return delay({
      type: "booking_status",
      appointment_id: id,
      status: "pending",
      faculty: "Dr. Bhavana V",
      slot: `${MONDAY}T11:00:00+05:30`,
      proposed_slot: null,
      faculty_note: null,
    });
  },

  cancelAppointment(id, reason) {
    return delay({
      type: "booking_status", appointment_id: id, status: "cancelled",
      faculty: "Dr. Bhavana V", slot: `${MONDAY}T11:00:00+05:30`,
      proposed_slot: null, faculty_note: null, cancel_reason: reason ?? null,
      actions: { cancel: false, cancel_needs_reason: false, answer_proposal: false },
    });
  },

  lookupAppointments(ids) {
    const base = {
      type: "booking_status", faculty: "Dr. Bhavana V",
      slot: `${MONDAY}T11:00:00+05:30`, end: `${MONDAY}T11:15:00+05:30`,
      duration_min: 15, proposed_slot: null, faculty_note: null,
      cancel_reason: null, purpose: "Doubt in the speech processing project",
      created_at: `${MONDAY}T09:00:00+05:30`, is_past: false,
    };
    const made = (ids ?? []).slice(0, 4).map((id, i) => {
      if (i === 0) return { ...base, appointment_id: id, status: "pending",
        actions: { cancel: true, cancel_needs_reason: true, answer_proposal: false } };
      if (i === 1) return { ...base, appointment_id: id, status: "rescheduled",
        proposed_slot: `${TUESDAY}T14:00:00+05:30`,
        faculty_note: "I have a meeting then — Tuesday suits better.",
        actions: { cancel: true, cancel_needs_reason: true, answer_proposal: true } };
      if (i === 2) return { ...base, appointment_id: id, status: "draft",
        actions: { cancel: true, cancel_needs_reason: false, answer_proposal: false } };
      return { ...base, appointment_id: id, status: "accepted", is_past: true,
        faculty_note: "Cabin 204.",
        actions: { cancel: false, cancel_needs_reason: false, answer_proposal: false } };
    });
    return delay({ appointments: made });
  },

  answerProposal(id, action) {
    return delay({
      type: "booking_status", appointment_id: id,
      status: action === "accept" ? "accepted" : "declined",
      faculty: "Dr. Bhavana V",
      slot: action === "accept" ? `${TUESDAY}T14:00:00+05:30` : `${MONDAY}T11:00:00+05:30`,
      proposed_slot: null, faculty_note: null, cancel_reason: null,
      actions: { cancel: action === "accept", cancel_needs_reason: true, answer_proposal: false },
    });
  },

  getStatus(id) {
    // Accepted on the third poll — long enough to see "pending" and the
    // card updating in place, short enough to not wait around.
    const count = (pollCounts.get(id) ?? 0) + 1;
    pollCounts.set(id, count);

    if (count < 3) {
      return delay({
        type: "booking_status",
        appointment_id: id,
        status: "pending",
        faculty: "Dr. Bhavana V",
        slot: `${MONDAY}T11:00:00+05:30`,
        proposed_slot: null,
        faculty_note: null,
      });
    }

    return delay({
      type: "booking_status",
      appointment_id: id,
      status: "accepted",
      faculty: "Dr. Bhavana V",
      slot: `${MONDAY}T11:00:00+05:30`,
      proposed_slot: null,
      faculty_note: "Meet at cabin 204",
    });
  },

  getRespond(id, token) {
    return delay(null).then(() => {
      if (token === "used") {
        throw new ApiError("This request was already answered.", 410);
      }
      return {
        student: {
          name: "Sai Amrith Reddy",
          roll_no: "BL.EN.U4EAC23051",
          branch: "Electronics and Computer Engineering",
          semester: 7,
          section: "A",
          email: "bl.en.u4eac23051@bl.students.amrita.edu",
        },
        slot: `${MONDAY}T11:00:00+05:30`,
        duration_min: 15,
        purpose: "Doubt in the speech processing project — feature extraction stage",
        message:
          "Good morning ma'am, I would like to meet you regarding my project. " +
          "Please let me know if this time works.",
        status: "pending",
        suggested_slots: [
          { date: TUESDAY, start: "11:00", end: "12:40" },
          { date: TUESDAY, start: "15:40", end: "16:20" },
        ],
      };
    });
  },

  submitResponse(id, payload) {
    return delay({ ok: true, action: payload.action });
  },

  getStudentResponse(id, token) {
    return delay(null).then(() => {
      if (token === "used") {
        throw new ApiError("This link has expired.", 410);
      }
      return {
        faculty: "Dr. Bhavana V",
        original_slot: `${MONDAY}T11:00:00+05:30`,
        proposed_slot: `${TUESDAY}T14:00:00+05:30`,
        faculty_note: "I have a meeting then — Tuesday afternoon suits better.",
        status: "rescheduled",
      };
    });
  },

  submitStudentResponse(id, payload) {
    return delay({ ok: true, action: payload.action });
  },
};

/* ---- mock message builders ---- */

function mockTimetable() {
  return {
    type: "timetable",
    day: "Tuesday",
    faculty: null,
    section: { program: "EAC", semester: 7, default_room: "B104" },
    entries: [
      {
        day: "Tuesday", start: "08:10", end: "09:00", kind: "lecture",
        courses: [{
          code: "23ECE445", title: "AI in Speech Signal Processing",
          faculty: ["Dr. Bhavana V"], rooms: ["A405"],
        }],
      },
      {
        day: "Tuesday", start: "09:00", end: "09:50", kind: "lecture",
        courses: [{
          code: "23ECE401", title: "VLSI Design",
          faculty: ["Dr. Deepthi Janardhan"], rooms: ["B104"],
        }],
      },
      {
        day: "Tuesday", start: "10:40", end: "12:40", kind: "lab",
        courses: [{
          code: "23ECE449", title: "Embedded Systems Lab",
          faculty: ["Dr. Rajesh K"], rooms: ["Lab 2"],
        }],
      },
      {
        day: "Tuesday", start: "13:30", end: "14:20", kind: "lecture",
        courses: [
          {
            code: "23ECE451", title: "Machine Learning",
            faculty: ["Dr. Priya S"], rooms: ["A402"],
          },
          {
            code: "23ECE452", title: "Computer Vision",
            faculty: ["Dr. Arun M"], rooms: ["A403"],
          },
        ],
        note: "Elective slot: each student attends their own elective.",
      },
      {
        day: "Tuesday", start: "15:40", end: "16:20", kind: "activity",
        courses: [], activity: "Evaluation",
      },
    ],
  };
}

function mockBusy() {
  return {
    type: "availability_result",
    faculty: "Dr. Bhavana V", faculty_id: 12,
    date: MONDAY, day: "Monday", time: "10:00", duration_min: 15,
    status: "busy",
    reason: "Class 23ECE445 from 09:50 to 10:40",
    bookable: false,
    alternatives: [
      { start: "11:00", end: "12:40" },
      { start: "15:40", end: "16:20" },
    ],
  };
}

function mockFree() {
  return {
    type: "availability_result",
    faculty: "Dr. Bhavana V", faculty_id: 12,
    date: MONDAY, day: "Monday", time: "11:00", duration_min: 15,
    status: "free",
    reason: "No class scheduled between 11:00 and 12:40",
    bookable: true,
    alternatives: [],
  };
}

function mockMaybe() {
  return {
    type: "availability_result",
    faculty: "Dr. Deepthi Janardhan", faculty_id: 7,
    date: TUESDAY, day: "Tuesday", time: "12:00", duration_min: 15,
    status: "maybe",
    reason: "No class, but this overlaps the usual lunch hour",
    bookable: true,
    alternatives: [{ start: "14:20", end: "15:40" }],
  };
}