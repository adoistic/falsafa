#!/usr/bin/env bun
// apps/a11y-tools/src/index.ts

const subcommand = process.argv[2];

switch (subcommand) {
  case "verify":
    await import("./verify.js").then((m) => m.main());
    break;
  case "generate":
    await import("./generate/index.js").then((m) => m.main(process.argv.slice(3)));
    break;
  default:
    console.error("usage: a11y-tools <verify|generate <kind>>");
    process.exit(2);
}
