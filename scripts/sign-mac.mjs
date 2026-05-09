/**
 * Codesign agent-dock.app with the user's Developer ID Application
 * identity (hardened runtime + entitlements). Signs inside-out:
 * nested .node / .dylib / .so first, then the embedded Neutralino
 * binary, then the launcher shim, then the .app bundle itself.
 *
 * Identity is read from $APPLE_DEVELOPER_ID. Example value:
 *   "Developer ID Application: Your Name (TEAMID12)"
 *
 * Usage:
 *   APPLE_DEVELOPER_ID="…" node scripts/sign-mac.mjs [path-to-app]
 *
 * If no path is given, defaults to dist/agent-dock.app.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, openSync, readdirSync, readSync, closeSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const APP = path.resolve(process.argv[2] ?? path.join(REPO, "dist", "agent-dock.app"));
const ENTITLEMENTS = path.join(REPO, "resources", "entitlements.plist");

const IDENTITY = process.env.APPLE_DEVELOPER_ID;
if (!IDENTITY) {
  console.error("✗ APPLE_DEVELOPER_ID environment variable is required.");
  console.error("  Example: APPLE_DEVELOPER_ID='Developer ID Application: Your Name (TEAMID12)'");
  console.error("  Find yours: security find-identity -v -p codesigning");
  process.exit(1);
}
if (!existsSync(APP)) {
  console.error(`✗ App bundle not found at ${APP}`);
  console.error("  Run `npm run package:mac` first.");
  process.exit(1);
}
if (!existsSync(ENTITLEMENTS)) {
  console.error(`✗ Entitlements file not found at ${ENTITLEMENTS}`);
  process.exit(1);
}

console.log(`▸ signing ${APP}`);
console.log(`  identity:    ${IDENTITY}`);
console.log(`  entitlements: ${ENTITLEMENTS}`);

const SIGN_ARGS = [
  "--force",
  "--options", "runtime",
  "--timestamp",
  "--sign", IDENTITY,
  "--entitlements", ENTITLEMENTS,
];

function sign(file) {
  const r = spawnSync("codesign", [...SIGN_ARGS, file], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`✗ codesign failed for ${file}`);
    process.exit(r.status ?? 1);
  }
}

// Inside-out: walk Resources/ and sign every nested mach-O binary.
// macOS rejects parent signatures if any nested binary is unsigned
// or signed with conflicting flags. Apple's notary service rejects
// nested executables that lack hardened-runtime + Developer ID,
// even if they're not invoked at runtime.
const MACH_O_MAGIC = new Set([
  0xfeedface, // 32-bit
  0xfeedfacf, // 64-bit
  0xcefaedfe, // 32-bit reverse
  0xcffaedfe, // 64-bit reverse
  0xcafebabe, // fat / universal
  0xbebafeca, // fat reverse
]);
function isMachO(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".node" || ext === ".dylib" || ext === ".so") return true;
  // Inspect the first 4 bytes for a Mach-O magic. Catches extensionless
  // executables shipped inside node_modules (esbuild, etc.).
  let fd;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(4);
    const n = readSync(fd, buf, 0, 4, 0);
    if (n < 4) return false;
    const magic = buf.readUInt32BE(0);
    return MACH_O_MAGIC.has(magic);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function walk(dir, fileVisitor) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(full, fileVisitor);
    } else if (entry.isFile()) {
      fileVisitor(full);
    }
  }
}

const nestedBinaries = [];
walk(path.join(APP, "Contents"), (file) => {
  if (isMachO(file)) nestedBinaries.push(file);
});

console.log(`▸ signing ${nestedBinaries.length} nested binaries (.node/.dylib/.so)`);
for (const file of nestedBinaries) sign(file);

// Then the embedded Neutralino binary. (We don't sign the bash
// launcher shim individually — codesign treats any sibling file in
// Contents/MacOS/ such as resources.neu as a sub-component and
// errors. The --deep bundle pass below covers the launcher.)
const neutralinoBin = path.join(APP, "Contents", "MacOS", "neutralino");
if (existsSync(neutralinoBin)) {
  console.log("▸ signing Contents/MacOS/neutralino");
  sign(neutralinoBin);
}

// Finally the .app bundle itself with --deep so codesign signs the
// launcher shim and re-validates every nested signature into a
// single coherent bundle signature.
console.log("▸ signing the .app bundle");
const r = spawnSync("codesign", [...SIGN_ARGS, "--deep", APP], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("✗ codesign failed for the bundle itself");
  process.exit(r.status ?? 1);
}

// Verify.
console.log("▸ verifying signature (codesign --verify --deep --strict)");
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", APP], { stdio: "inherit" });

console.log("\n✓ signed and verified.");
console.log(`  app:    ${APP}`);
console.log("  next:   npm run package:dmg:signed   (or)   npm run notarize");
