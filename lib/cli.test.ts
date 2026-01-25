import { describe, test, expect } from "bun:test";
import { parseBool } from "./cli.ts";

describe("parseBool", () => {
  describe("truthy values", () => {
    test("returns true for 'true'", () => {
      expect(parseBool("true")).toBe(true);
    });

    test("returns true for 'TRUE'", () => {
      expect(parseBool("TRUE")).toBe(true);
    });

    test("returns true for 'True'", () => {
      expect(parseBool("True")).toBe(true);
    });

    test("returns true for '1'", () => {
      expect(parseBool("1")).toBe(true);
    });
  });

  describe("falsy values", () => {
    test("returns false for 'false'", () => {
      expect(parseBool("false")).toBe(false);
    });

    test("returns false for 'FALSE'", () => {
      expect(parseBool("FALSE")).toBe(false);
    });

    test("returns false for 'False'", () => {
      expect(parseBool("False")).toBe(false);
    });

    test("returns false for '0'", () => {
      expect(parseBool("0")).toBe(false);
    });
  });

  describe("invalid values default to true", () => {
    test("returns true for empty string", () => {
      expect(parseBool("")).toBe(true);
    });

    test("returns true for 'yes'", () => {
      expect(parseBool("yes")).toBe(true);
    });

    test("returns true for 'no'", () => {
      expect(parseBool("no")).toBe(true);
    });

    test("returns true for arbitrary string", () => {
      expect(parseBool("enabled")).toBe(true);
    });
  });
});
