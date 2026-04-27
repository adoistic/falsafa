/**
 * Tiny className join helper. Like clsx but small enough not to warrant a dep.
 * Accepts strings, falsy values, and { className: condition } objects.
 */
type Arg = string | undefined | null | false | Record<string, unknown>;

export function cx(...args: Arg[]): string {
  const out: string[] = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === "string") {
      out.push(a);
    } else if (typeof a === "object") {
      for (const [key, val] of Object.entries(a)) {
        if (val) out.push(key);
      }
    }
  }
  return out.join(" ");
}
