/**
 * Feature configuration.
 *
 * One file, because these are the values most likely to need changing
 * by someone who isn't going to read the components.
 */

/** Student emails must be on this domain. */
export const ALLOWED_EMAIL_DOMAIN = "bl.students.amrita.edu";

/** Roll numbers look like BL.EN.U4EAC23051. */
export const ROLL_PATTERN = /^[A-Z]{2}\.[A-Z]{2}\.[A-Z0-9]+$/i;

export const PURPOSE_MAX = 300;

export const DURATIONS = [15, 30, 45];

/** Where the student's own details are remembered between requests. */
export const STUDENT_STORAGE_KEY = "triage_student_details";
