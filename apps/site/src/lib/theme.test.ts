import { describe, expect, test } from "bun:test";
import { resolveTheme, THEME_MODES } from "./theme";

describe("resolveTheme", () => {
  test("explicit modes are returned as-is, regardless of OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("sepia", true)).toBe("sepia");
  });

  test("system follows the OS dark preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("unset / null / unknown falls back to system behaviour", () => {
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("", true)).toBe("dark");
    expect(resolveTheme("bogus", false)).toBe("light");
  });

  test("THEME_MODES lists system first and covers all four modes", () => {
    expect(THEME_MODES[0].mode).toBe("system");
    expect(THEME_MODES.map((m) => m.mode)).toEqual(["system", "light", "dark", "sepia"]);
  });
});
