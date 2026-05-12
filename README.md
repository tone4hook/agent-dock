# Agent*Dock

A macOS desktop app that drives Claude Code (and other coding-agent CLIs) for Atlassian-grounded engineering work. Pick a workspace, link a Jira issue or Confluence page to a task, and a session runs an `investigate → plan → human-approval → implement → code-review` pipeline against a fresh git worktree.

Built on React + shadcn/ui, an Express + SQLite API, and a Neutralino window. Single-user, local-first — no shared backend, no SaaS dependency for state.

## Quick start (development)

Requires **macOS 11+**, **Node 24+**, and a Claude Code (or Gemini / Codex) CLI on your PATH. The Node 24 floor is driven by `better-sqlite3`'s native bindings — older Node majors hit an ABI mismatch at first DB open.

```bash
# clone, then:
export NODE_AUTH_TOKEN=ghp_…              # see "GitHub Packages auth" below
npm install
npm run db:migrate
npm run dev
```

`npm run dev` starts the API, the Vite web app, and a Neutralino window together. The first launch opens an onboarding flow:

1. **Workspace** — pick a parent directory containing your cloned repos. Agent*Dock auto-discovers first-level git repos. Worktrees go under `<workspace>/worktrees/`.
2. **Atlassian credentials** *(optional)* — Jira site URL, email, API token. Skip this and you can add it later in Settings; tasks will still run, just without Atlassian context.

## Install (end users)

If someone has shipped you a `dist/agent-dock.dmg` from a release build:

1. Double-click the DMG, drag `agent-dock` to Applications.
2. Launch from Launchpad. The first-run dialog says *"agent-dock is an app downloaded from the Internet…"* — click **Open**.
3. Complete the onboarding flow (workspace + optional Atlassian creds).

The app is signed with a Developer ID Application certificate and notarized by Apple, so Gatekeeper doesn't block it. No `xattr` workaround needed.

**On the receiving Mac you'll also need:**

- **Node 24+** on PATH. The launcher auto-discovers Homebrew, nvm, volta, fnm, and asdf installs; missing Node shows a critical alert with the install URL. Node 24 is a hard requirement: `better-sqlite3` (the API's SQLite driver) ships native bindings that fail to load on older Node majors, so the app will refuse to open its database on Node 20 / 22.
- Whichever coding-agent CLIs the workflow invokes (`claude`, `gemini`, `codex`) plus `gh` and `git`, on PATH from a directory the launcher already prepends: the Node bin dir, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.local/bin`, or `~/.cargo/bin`.

## GitHub Packages auth

The orchestration SDK (`@tone4hook/headless-coding-agent-sdk`) is published to GitHub Packages, which requires authentication even for public reads. Copy `.npmrc.example` to `.npmrc` (or merge the lines into your user-global `~/.npmrc`), then export a token with `read:packages` scope:

```bash
export NODE_AUTH_TOKEN=ghp_your_token_here
npm install
```

Don't commit `.npmrc` with a real token — the file in the repo uses `${NODE_AUTH_TOKEN}` so the env var is the secret.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | API + web + Neutralino, hot-reload. |
| `npm run build` | Compile workspaces, web bundle, Neutralino resources. |
| `npm run typecheck` | TypeScript verification across all packages. |
| `npm run db:migrate` | Apply migrations to `~/.agent-dock/agent-dock.sqlite` (or `$AGENT_DOCK_DATA_DIR`). |
| `npm run package:mac` | Build an ad-hoc-signed `dist/agent-dock.app` for local smoke. |
| `npm run package:dmg` | Wrap the `.app` into `dist/agent-dock.dmg`. |
| `npm run package:mac:signed` | Same as `package:mac` but Developer ID-signed with hardened runtime (requires `APPLE_DEVELOPER_ID`). |
| `npm run package:dmg:signed` | Same as `package:dmg` but Developer ID-signed. |
| `npm run notarize` | Submit `dist/agent-dock.app` to Apple's notary service, staple the ticket, then rebuild the DMG with the stapled `.app` and notarize+staple the DMG too. |
| `npm run release:mac` | Full pipeline: `package:mac:signed` then `notarize`. |

## Build a release DMG

### One-time setup

1. **Apple Developer Program** membership ($99/yr).
2. **Developer ID Application certificate** in your login keychain — Keychain Access → Certificate Assistant → Request a Certificate; upload the CSR at developer.apple.com → Certificates → Software → **Developer ID Application**; install the resulting `.cer` plus Apple's [Developer ID G2 intermediate](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer). Confirm with `security find-identity -v -p codesigning`.
3. **App-specific password** at [appleid.apple.com](https://appleid.apple.com/account/manage) → Sign-In and Security → App-Specific Passwords (label it `agent-dock-notarize`).
4. **Store notarytool credentials** once:

   ```bash
   xcrun notarytool store-credentials agent-dock \
     --apple-id <your-apple-id-email> \
     --team-id  <YOUR-TEAM-ID> \
     --password <app-specific-password>
   ```

### Every release

```bash
export APPLE_DEVELOPER_ID="Developer ID Application: Your Name (TEAMID12)"
npm run release:mac
```

Apple's notary verdict typically lands in 1–5 minutes. The result is `dist/agent-dock.dmg` ready to drag-install on any Mac with no Gatekeeper friction.

## Architecture overview

- `apps/api` — Express server, SSE event bus, SQLite repos. Composition root at `apps/api/src/buildContainer.ts`.
- `apps/web` — React + shadcn/ui frontend. Boots from `apps/web/src/main.tsx`.
- `packages/shared` — Zod schemas + types shared across API and web.
- `packages/db` — better-sqlite3 wrappers + migrations.
- `packages/agents` — `ProviderAdapter` per CLI (`claude`, `gemini`, `codex`).
- `packages/orchestrator` — `RunCoordinator` (single-run lifecycle, no HTTP).
- `packages/workflows` — feature-flow pipeline definition.
- `packages/worktrees` — git worktree lifecycle per Session.
- `packages/atlassian` — Jira + Confluence clients, ADF parsing, Keychain-backed creds.
- `packages/artifacts` — on-disk artifact store mirroring the `artifacts` table.
- `scripts/build-mac.mjs`, `scripts/make-dmg.mjs`, `scripts/sign-mac.mjs`, `scripts/notarize-mac.mjs` — packaging.
- `scripts/launcher.swift` — Mach-O `CFBundleExecutable` (compiled at package time; locates Node, spawns the API, then exec's Neutralino).

See `CONTEXT.md` for the domain vocabulary used across the codebase.

## License

MIT — see [LICENSE](LICENSE).
