/**
 * Wrap dist/agent-dock.app into a draggable .dmg using macOS hdiutil.
 * No external deps. Output: dist/agent-dock.dmg.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const APP = path.join(REPO, "dist", "agent-dock.app");
const DMG = path.join(REPO, "dist", "agent-dock.dmg");
const VOLNAME = "Agent Dock";

if (!existsSync(APP)) {
  console.error(`✗ ${APP} not found. Run 'npm run package:mac' first.`);
  process.exit(1);
}

if (existsSync(DMG)) {
  rmSync(DMG);
}

const stage = mkdtempSync(path.join(tmpdir(), "agent-dock-dmg-"));
console.log(`▸ stage ${stage}`);
cpSync(APP, path.join(stage, "agent-dock.app"), { recursive: true });
symlinkSync("/Applications", path.join(stage, "Applications"));

console.log("▸ hdiutil create");
execFileSync(
  "hdiutil",
  [
    "create",
    "-volname", VOLNAME,
    "-srcfolder", stage,
    "-ov",
    "-format", "UDZO",
    DMG,
  ],
  { stdio: "inherit" },
);

rmSync(stage, { recursive: true, force: true });

// Optionally sign the DMG itself with the user's Developer ID. The
// staple step in notarize-mac.mjs requires a signed DMG — without
// this, `xcrun stapler staple` rejects the disk image.
if (process.argv.includes("--sign")) {
  const identity = process.env.APPLE_DEVELOPER_ID;
  if (!identity) {
    console.error("✗ --sign requires APPLE_DEVELOPER_ID env var.");
    console.error("  Example: APPLE_DEVELOPER_ID='Developer ID Application: Your Name (TEAMID12)'");
    process.exit(1);
  }
  console.log("▸ codesign the DMG");
  execFileSync(
    "codesign",
    ["--force", "--timestamp", "--sign", identity, DMG],
    { stdio: "inherit" },
  );
}

console.log(`\n✓ ${DMG}`);
console.log("  Install: double-click the DMG and drag agent-dock to Applications.");
if (!process.argv.includes("--sign")) {
  console.log("  First launch (unsigned): xattr -d com.apple.quarantine /Applications/agent-dock.app");
} else {
  console.log("  Next: npm run notarize");
}
