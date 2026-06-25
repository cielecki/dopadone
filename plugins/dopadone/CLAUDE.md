# health-rhythm — Claude Code plugin (read before touching this repo)

This is a **Claude Code plugin**, not an app. It injects per-turn health/time
context (a "soft interrupt" directive + `<time-marker>` / `<interrupt>` XML
tags) into Maciej's sessions.

**As of v2.4.0 (#289 F1) the plugin is TypeScript**, ported from the original
Bash at strict behavioral parity. Source is in `src/`; esbuild bundles two
self-contained CJS hooks into `bin/` (committed — end users run them without
`pnpm install`). `hooks/hooks.json` invokes `node bin/*.cjs`. The decision math
(phase classification, the two probability channels, routine-gate, cooldown,
retry escalation) is reproduced **locally** in TS — it does NOT import
`@dopadone/core` at runtime (core's fixed-boundary `phaseFor`/`surfacingProbability`
would break parity; the `@dopadone/core/habits` seam is the foundation for the
F2 standalone work, not consumed here). The hook still shells out to the
`dopadone` CLI for `habits agenda --json` + the recommended actions.

The original **Bash files (`lib/inject.sh`, `scripts/*.sh`) are retained,
unwired, for one-line rollback** — flip `hooks/hooks.json` back to them. They are
NOT the live implementation anymore; do not edit them expecting effect.

## What's actually here

```
src/                             # TS source — the live implementation
  config.ts  agenda.ts  clock.ts # config (env), CLI wire types + fetch, wall-clock
  phase.ts  probability.ts       # phase classify + the two probability channels
  override.ts  retry.ts  state.ts# override match, retry counter, state files
  routine-gate.ts  directive.ts  # interactive-only gate, directive text builders
  emit.ts                        # <dopadone> XML + additionalContext JSON
  user-prompt.ts  notification.ts# the two hook entries (run()/main() + computeNotification)
  bin-*.ts                       # thin esbuild entry wrappers → bin/*.cjs
  *.test.ts                      # vitest parity suite (co-located)
bin/                             # COMMITTED esbuild output (the shipped hooks)
.claude-plugin/plugin.json       # plugin manifest (name, version, userConfig)
.claude-plugin/marketplace.json  # directory-marketplace entry (own version field, ×2)
hooks/hooks.json                 # UserPromptSubmit + Notification wiring → node bin/*.cjs
references/interrupt-protocol.md # full interrupt how/why — Claude reads it ONCE per
                                 # conversation; per-turn block stays compact + points here
lib/inject.sh  scripts/*.sh      # RETAINED bash (unwired) — rollback only
tools/f0-smoke.ts                # @dopadone/core/habits seam regression check (build:smoke)
README.md  LICENSE  .gitignore
```

To understand behavior, read `src/` (start at `user-prompt.ts` `run()` — the flow
mirrors the old `scripts/user-prompt.sh` 1:1). The bash files are reference/rollback.

## Hard-won conventions (each cost real session time)

- **NEVER add a `"hooks"` key to `plugin.json`.** Claude Code auto-loads
  `hooks/hooks.json` for any plugin. Declaring hooks *also* in `plugin.json`
  triggers `Duplicate hooks file detected` and the plugin **fails to load
  entirely** (silent — no health context appears). Hooks are wired ONLY in
  `hooks/hooks.json`.

- **Bump the version in FOUR places, in lockstep:** `package.json` `version`
  (1×, new in v2.4.0), `plugin.json` `version` (1×) **and** `marketplace.json`
  (2× — a top-level `version` and a nested one under the plugin entry). A desynced
  marketplace version was a real bug fixed in v2.0.0. Quick check after a bump:
  `grep -rn '"version"' package.json .claude-plugin/*.json` should show the same string 4×.

- **Rebuild `bin/` after editing `src/`, and commit it.** `pnpm build` (esbuild)
  regenerates `bin/user-prompt.cjs` + `bin/notification.cjs` — the SHIPPED hooks.
  A source edit has NO effect until rebuilt; the committed bundle is what runs in
  anyone else's session (no `pnpm install` on their side). Run `pnpm test` (vitest)
  before committing — the suite is the bash→TS parity proof.

- **`claude plugin update` does NOT work for this plugin.** It's installed from
  a *directory* marketplace, and `claude plugin update` reports "not found" for
  directory-sourced plugins. The working refresh is **uninstall + reinstall**.
  Don't burn turns retrying `update`.

- **A hook injects TEXT deterministically, but CANNOT force a tool call.**
  `additionalContext` always lands in context; a "read this file" pointer does
  NOT — the model decides whether to `Read` it. Measured read-rate of
  `references/interrupt-protocol.md` across real sessions (2026-06-04): **0/3**
  for trivial habit interrupts, **~3/6** for richer evening ones. So any
  MUST-HAVE specific goes **inline** in the injected block, or in the habit's own
  `description` (injected inline via `Opis:`). The protocol file is for
  high-frequency repetitive boilerplate (work/wrapup anchoring style) only, and is
  treated as **best-effort**. Don't move must-have behavior behind the file pointer.
  (Evening/sleep directives were moved back fully inline in `7990687` for exactly
  this reason — rare + phase-specific, so no file dependency. The note-vs-instruction
  judgment for a habit's `description` was likewise inlined in v2.3.2 (#286): the
  description text was always inline as `Opis:`, but the *judgment to act on it* used
  to live only in the unread protocol file, so the gratitude-ritual journal-write
  silently never ran. It now emits inline ONLY when `description` is non-empty, so
  trivial habits stay cheap.)

- **No CLAUDE.md is bundled INTO the plugin** (Claude Code can't ship a plugin
  CLAUDE.md), so this file lives at the repo root for dev sessions only — it is
  not loaded when the plugin runs in someone else's session.

## Git / push

This repo is under `apps/` (personal). Its `main` is NOT in the auto-classifier's
authorized-push allowlist, so a compound `git add && git commit && git push` can
get denied as a unit (discarding the commit). Commit first, push as a separate
step. Standard: never `--force`, never rewrite history.

## How to verify a change

1. **`pnpm test`** — the vitest suite (`src/*.test.ts`) is the parity gate: phase
   boundaries (incl. the midnight wrap), both probability channels, override
   synonyms, retry tiers, routine-gate (incl. the 131072 B transcript fallback),
   directive text, notification timing, and a `run()` integration test with a
   stubbed agenda + injected clock/RNG.
2. **`pnpm build`** then fixture-replay the bundle: pipe a hook-input JSON to
   `node bin/user-prompt.cjs` with `CLAUDE_PLUGIN_OPTION_DOPADONE_PATH` pointing at
   a stub that prints an agenda, and `CLAUDE_PLUGIN_DATA=/tmp/...` for isolated
   state. Confirm the emitted `additionalContext` carries the right
   `<dopadone .../>` tag for the wall-clock phase (and that a `<scheduled-task`
   prompt stays silent).
3. **`pnpm build:smoke && pnpm smoke`** — proves the `@dopadone/core/habits` seam
   still bundles clean (no ical.js / fs leak); the foundation for the F2 standalone
   work, not used by the live hook.
4. Hooks load at **session start**, so a cutover/edit only affects a *new* session
   (the `@skills-dir` symlink makes the rebuilt `bin/` live next launch).
