/**
 * Notarize the signed agent-dock.app, then build a DMG containing the
 * stapled .app, then sign and staple the DMG. This ordering matters:
 *
 *   1. notarize the .app (via a zip wrapper)
 *   2. staple the .app
 *   3. build the DMG with the stapled .app inside
 *   4. notarize the DMG
 *   5. staple the DMG
 *
 * Submitting the DMG first and trying to staple the .app afterwards
 * fails Gatekeeper validation: spctl rejects with "Unnotarized
 * Developer ID" because the ticket attached to the .app does not
 * match its CDHash exactly.
 *
 * Notarytool credentials must already be stored under the keychain
 * profile "agent-dock" via:
 *   xcrun notarytool store-credentials agent-dock --apple-id <email> --team-id <TEAM> --password <app-spec>
 *
 * Usage:
 *   node scripts/notarize-mac.mjs [path-to-app] [path-to-dmg]
 *
 * Defaults to dist/agent-dock.app + dist/agent-dock.dmg.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const APP = path.resolve(process.argv[2] ?? path.join(REPO, "dist", "agent-dock.app"));
const DMG = path.resolve(process.argv[3] ?? path.join(REPO, "dist", "agent-dock.dmg"));
const ZIP = path.join(path.dirname(APP), "agent-dock-for-notary.zip");
const PROFILE = "agent-dock";
const IDENTITY = process.env.APPLE_DEVELOPER_ID;

if (!existsSync(APP)) {
  console.error(`✗ App not found at ${APP}. Run npm run package:mac:signed first.`);
  process.exit(1);
}
if (!IDENTITY) {
  console.error("✗ APPLE_DEVELOPER_ID environment variable is required.");
  process.exit(1);
}

function notarize(target, label) {
  console.log(`\n▸ submitting ${label} to Apple notary service`);
  const submit = spawnSync(
    "xcrun",
    ["notarytool", "submit", target, "--keychain-profile", PROFILE, "--wait", "--output-format", "plist"],
    { stdio: ["inherit", "pipe", "inherit"] },
  );
  const stdout = submit.stdout?.toString() ?? "";
  process.stdout.write(stdout);

  if (submit.status !== 0) {
    console.error(`✗ notarytool submit failed for ${label} (non-zero exit).`);
    process.exit(submit.status ?? 1);
  }

  const idMatch = stdout.match(/<key>id<\/key>\s*<string>([^<]+)<\/string>/);
  const statusMatch = stdout.match(/<key>status<\/key>\s*<string>([^<]+)<\/string>/);
  const submissionId = idMatch?.[1];
  const status = statusMatch?.[1];

  if (!submissionId) {
    console.error("✗ could not parse submission id from notarytool output.");
    process.exit(1);
  }

  console.log(`  submission id: ${submissionId}`);
  console.log(`  status:        ${status ?? "(unknown)"}`);

  if (status !== "Accepted") {
    console.error(`✗ notarization status for ${label} is "${status}" — fetching log:`);
    spawnSync(
      "xcrun",
      ["notarytool", "log", submissionId, "--keychain-profile", PROFILE],
      { stdio: "inherit" },
    );
    process.exit(1);
  }
}

// ── Step 1: zip the .app and submit to notary.
console.log(`▸ zipping ${APP} → ${ZIP}`);
if (existsSync(ZIP)) rmSync(ZIP);
execFileSync("ditto", ["-c", "-k", "--keepParent", APP, ZIP], { stdio: "inherit" });

notarize(ZIP, "the .app (zipped)");

// ── Step 2: staple the .app.
console.log("\n▸ stapling the ticket to the .app");
execFileSync("xcrun", ["stapler", "staple", APP], { stdio: "inherit" });
execFileSync("xcrun", ["stapler", "validate", APP], { stdio: "inherit" });

// Clean up the zip — only needed for the notary submission.
rmSync(ZIP);

// ── Step 3: rebuild the DMG with the now-stapled .app inside.
console.log("\n▸ rebuilding DMG with stapled .app");
execFileSync(process.execPath, [path.join(REPO, "scripts", "make-dmg.mjs"), "--sign"], {
  stdio: "inherit",
  env: { ...process.env },
});

// ── Step 4: notarize the DMG (this also produces a DMG-level ticket
// so users get a clean Gatekeeper read on the DMG itself).
notarize(DMG, "the DMG");

// ── Step 5: staple the DMG.
console.log("\n▸ stapling the ticket to the DMG");
execFileSync("xcrun", ["stapler", "staple", DMG], { stdio: "inherit" });
execFileSync("xcrun", ["stapler", "validate", DMG], { stdio: "inherit" });

console.log("\n✓ notarized + stapled.");
console.log(`  app: ${APP}`);
console.log(`  dmg: ${DMG}`);
console.log("\n  Distribute the DMG. Users can drag-install with no Gatekeeper friction.");
