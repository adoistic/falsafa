export async function main(args: string[]): Promise<void> {
  const kind = args[0];
  switch (kind) {
    case "vpat":
      await import("./vpat.js").then((m) => m.generate());
      break;
    case "annex-f":
      await import("./annex-f.js").then((m) => m.generate());
      break;
    case "matrix":
      await import("./matrix.js").then((m) => m.generate());
      break;
    default:
      console.error("usage: a11y-tools generate <vpat|annex-f|matrix>");
      process.exit(2);
  }
}
