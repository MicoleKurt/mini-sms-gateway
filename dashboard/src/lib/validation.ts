/**
 * Input rules for a message. They mirror the gateway (docs/API.md,
 * "POST /v1/messages") so the form can explain a problem before the round
 * trip. The gateway stays the authority: its errors are shown as well.
 */
const E164 = /^\+[1-9]\d{6,14}$/;
const SENDER_ID = /^(?:[A-Za-z0-9 ]{1,11}|\d{3,15})$/;

export const MAX_SEGMENTS = 10;
export const MAX_CLIENT_REF_LENGTH = 64;

export function validateDestination(value: string): string | null {
  if (value === "") return "Enter a destination number.";
  if (!E164.test(value)) {
    return "Use E.164: a plus sign, then 7 to 15 digits, not starting with 0.";
  }
  return null;
}

export function validateSender(value: string): string | null {
  if (value === "") return "Enter a sender ID.";
  if (!SENDER_ID.test(value)) {
    return "Use 1 to 11 letters, digits or spaces, or 3 to 15 digits.";
  }
  return null;
}

export function validateText(text: string, segments: number): string | null {
  if (text === "") return "Enter the message text.";
  if (segments > MAX_SEGMENTS) {
    return `This is ${segments} segments. The limit is ${MAX_SEGMENTS}.`;
  }
  return null;
}

export function validateClientRef(value: string): string | null {
  if (value.length > MAX_CLIENT_REF_LENGTH) {
    return `Use at most ${MAX_CLIENT_REF_LENGTH} characters.`;
  }
  return null;
}
