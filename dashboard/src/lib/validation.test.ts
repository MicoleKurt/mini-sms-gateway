import { describe, expect, it } from "vitest";
import { validateClientRef, validateDestination, validateSender, validateText } from "./validation";

describe("validateDestination", () => {
  it.each(["+8801711000001", "+1202555", "+447700900123456"])("accepts %s", (value) => {
    expect(validateDestination(value)).toBeNull();
  });

  it.each([
    "",
    "8801711000001",
    "+0801711000001",
    "+12345",
    "+1234567890123456",
    "+1 202 555 0123",
  ])("rejects %j", (value) => {
    expect(validateDestination(value)).not.toBeNull();
  });
});

describe("validateSender", () => {
  it.each(["ACME", "Acme Bank 1", "A", "123", "123456789012345"])("accepts %s", (value) => {
    expect(validateSender(value)).toBeNull();
  });

  it.each(["", "TwelveLetter", "ACME!", "1234567890123456", "Ünï"])("rejects %j", (value) => {
    expect(validateSender(value)).not.toBeNull();
  });
});

describe("validateText and validateClientRef", () => {
  it("requires text and caps it at ten segments", () => {
    expect(validateText("", 1)).not.toBeNull();
    expect(validateText("hello", 10)).toBeNull();
    expect(validateText("hello", 11)).not.toBeNull();
  });

  it("allows an empty client_ref and caps it at 64 characters", () => {
    expect(validateClientRef("")).toBeNull();
    expect(validateClientRef("x".repeat(64))).toBeNull();
    expect(validateClientRef("x".repeat(65))).not.toBeNull();
  });
});
