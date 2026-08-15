#!/usr/bin/env node
/**
 * Refuse to `next build` while a dev server is running.
 *
 * Both write to the same .next directory, so a build swaps the chunk files out
 * from under a live `next dev` and the running app dies with
 * "Cannot find module './819.js'". The app is fine; the server just lost its
 * files. It looks like a code bug and isn't, which is what makes it expensive.
 *
 * CI has no dev server, so this is a no-op there. Set ALLOW_BUILD_WITH_DEV=1 to
 * override deliberately.
 */

const { execSync } = require("node:child_process");

const PORT = process.env.PORT || "3000";

if (process.env.CI || process.env.ALLOW_BUILD_WITH_DEV) process.exit(0);

let inUse = false;
try {
  // -sTCP:LISTEN so a browser's outbound connection to :3000 doesn't count.
  const out = execSync(`lsof -ti :${PORT} -sTCP:LISTEN`, {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  inUse = out.length > 0;
} catch {
  inUse = false; // lsof exits non-zero when nothing is listening
}

if (inUse) {
  console.error(
    `\n  A dev server is listening on port ${PORT}.\n\n` +
      `  'next build' and 'next dev' share the .next directory, so building now\n` +
      `  would break the running server with "Cannot find module './NNN.js'".\n\n` +
      `  Stop it, clear the directory, and rebuild — in that order:\n\n` +
      `      rm -rf .next && npm run build\n\n` +
      `  Then 'npm run dev' again (it rebuilds .next from scratch).\n` +
      `  Override with ALLOW_BUILD_WITH_DEV=1 if you really mean it.\n`
  );
  process.exit(1);
}
