# DopaDone agent plugin

A shared Claude Code and Codex plugin. Both hosts get the explicit `do` workflow
and deterministic local date/time markers. Claude Code additionally gets
**probabilistic health-habit reminders** backed by
[dopadone](https://github.com/cielecki/dopadone) habit data.

## What it does

The plugin runs a **4-phase sleep schedule** that is **orthogonal to habit reminders** — habits (eat lunch, brush teeth) fire on their own probabilistic track all day; the phases layer wind-down/sleep pressure on top only in the evening. The current local time falls into one phase, with minute-granular `HH:MM` boundaries:

| Phase | Default window | What happens |
|---|---|---|
| **work** | `07:00` → `22:00` | Sleep schedule is silent. Only habit reminders fire. |
| **wrap-up** | `22:00` → `23:00` | Soft **non-blocking** "close your loops, wind the day down" nudges — work continues uninterrupted, the nudge is appended to a normal answer. |
| **evening-routine** | `23:00` → `23:30` | **Blocking** interrupt: refuses further work, discovers your own wind-down routine from whatever data it can reach at runtime, and persuades you against taking sleep debt (efficiency framing — work is better done fresh in the morning). |
| **sleep** | `23:30` → `07:00` | **Near-total refusal.** Every prompt is blocked; the override phrase is the only escape (retry never wins). |

On every `UserPromptSubmit`, the plugin:

1. Queries `dopadone habits agenda --json` to see what's open / overdue / snoozed / muted.
2. Classifies the current time into one of the four phases (`hr_phase`).
3. **Habit channel** (all phases): computes per-turn habit-urgency probability and may fire a blocking single-imperative reminder — exactly as before.
4. **Sleep-schedule channel** (evening/sleep): adds a phase baseline the blocking probability is max'd against. Wrap-up instead fires a separate **non-blocking** nudge (`event="wrapup"`) gated by its own cadence + intensity.
5. If nothing fires AND the plugin hasn't injected anything to this session in the last `time_marker_interval_minutes` (default 20), emits a tiny `<dopadone event="time-marker" date="YYYY-MM-DD" time="HH:MM"/>` so Claude doesn't lose track of wall-clock date/time in long conversations.

All plugin output is wrapped in a `<dopadone event="..." date="..." time="..." ...>` XML tag so Claude can distinguish plugin signal from conversation content. Attributes carry meta (`event` — `interrupt` / `wrapup` / `time-marker`, `date`, `time`, `mode`/`faza`, `retry`); content (for interrupt + wrapup) is the directive.

Plus `Notification` — OS desktop notifications at meal-window openings (08:00 / 13:00 / 18:00), wrap-up start, evening-routine start, and ~10 min before sleep. Per-boundary hourly dedup so it doesn't spam.

## Why probabilistic interrupt instead of constant nagging

Earlier iterations injected reminders as `additionalContext` every turn — Claude wove them into responses, but the nudges were easy to ignore, leaked internal jargon ("missed-today", "+222min"), and didn't push the user to act.

Probabilistic interrupt is the opposite of nag:
- Most work-hour turns are completely silent (no token cost, no clutter).
- When a blocking interrupt fires, Claude visibly drops your request and shows the reminder — impossible to miss.
- During the day (and in wrap-up/evening) retry stays an escape valve — probability is capped at 99% so a genuine retry storm eventually passes.
- The **sleep phase is the exception**: probability is forced to 100%, so retrying never breaks through. Only the override phrase does.
- Phases ramp the pressure: work (silent) → wrap-up (soft, non-blocking) → evening-routine (firm, persuasive) → sleep (refusal).
- The override phrase (`wiem, override` by default — configurable) bypasses entirely for genuine emergencies.
- Directives are **directional, not scripted** — Claude composes the actual reminder text in natural language. No template-prison.

## Requirements

- **`node` on PATH** — as of v2.4.0 the hooks are TypeScript, shipped as prebuilt
  CJS bundles in `bin/` (run via `node`); no `npm install` needed to use the plugin.
- macOS (uses `osascript` for desktop notifications)
- [`dopadone`](https://github.com/cielecki/dopadone) CLI installed and on PATH (or path configured via `dopadone_path`)
- `dopadone habits agenda --json` returning the standard agenda schema (added in dopadone v1.11.0)

## Installation

### Always-on personal use — `@skills-dir` via symlink (recommended)

Loads on every session and — crucially — **picks up repo edits live** (the plugin is discovered in place, never copied to a version-pinned cache). Symlink the clone into your personal skills directory:

```bash
git clone https://github.com/cielecki/dopadone ~/workspace/projects/dopadone-public
ln -sfn ~/workspace/projects/dopadone-public/plugins/dopadone ~/.claude/skills/dopadone
```

Next session it loads as `dopadone@skills-dir` (verify: `claude plugin list`). No marketplace, no install step, no `enabledPlugins` entry — personal-scope `@skills-dir` plugins are on by default. A SKILL/script edit is live on the next session (hook changes need `/reload-plugins` or a restart). Remove with `rm ~/.claude/skills/dopadone`. (`@skills-dir` discovery follows the symlink, so the repo stays put.)

### Local / one-off — `--plugin-dir`

For a single session without the symlink:

```bash
claude --plugin-dir ~/workspace/projects/dopadone-public/plugins/dopadone
```

Claude prompts for the userConfig values (dopadone path, sleep hours, override phrase, language) on first launch. Defaults match Maciej's setup; tweak as needed.

### Via marketplace (future)

Not yet published. Once on a marketplace:

```bash
claude plugin marketplace add cielecki/dopadone
claude plugin install dopadone@dopadone
```

> **Heads-up — marketplace installs are cached and version-pinned.** Unlike the `@skills-dir` symlink above, a marketplace install is *copied* into `~/.claude/plugins/cache/…` and pinned to the installed version. End users do **not** get changes by you pushing commits — they receive an update only when you **bump `version` in `.claude-plugin/plugin.json`** (this plugin uses explicit versions, so a same-version push is invisible), and even then their install refreshes only via `claude plugin update dopadone@dopadone` / auto-update / reinstall. Document this in the user-facing README before publishing, so nobody debugs a "stale plugin" that's really just a pinned cache.

## Configuration

All settings live in `.claude-plugin/plugin.json` under `userConfig` and are filled in by Claude Code at install time. Values land in `~/.claude/settings.json` under the installed DopaDone plugin's `pluginConfigs` entry and are exposed to scripts as `$CLAUDE_PLUGIN_OPTION_*` env vars.

| Field | Default | What it does |
|---|---|---|
| `reminders_enabled` | `true` | Master switch for every **nudge** — habit interrupts, wrap-up, the evening/sleep block, OS notifications. Set `'false'` for **time-awareness only**: the `time-marker` keeps firing, nothing else does, and the `dopadone` CLI is no longer spawned per prompt. Also readable from the plain env var `DOPADONE_REMINDERS_ENABLED` (which wins over the plugin option, so it works from `settings.json` → `env`). Off values: `false`, `0`, `off`, `no`. |
| `dopadone_path` | `dopadone` | Path to the `dopadone` binary. Plugin invokes `<path> habits agenda --json`. |
| `work_start` | `07:00` | HH:MM when the sleep phase ends and work begins (sleep schedule silent). |
| `wrapup_start` | `22:00` | HH:MM when soft non-blocking wrap-up nudges begin. |
| `evening_start` | `23:00` | HH:MM when blocking evening-routine refusals + persuasion begin. |
| `sleep_start` | `23:30` | HH:MM when near-total refusal begins (override-only). |
| `wrapup_intensity` | `35` | Probability % an eligible wrap-up turn emits a non-blocking nudge. `0` disables the channel. |
| `evening_intensity` | `70` | Baseline probability % for evening-routine blocking interrupts (max'd with habit urgency, capped 99). |
| `wrapup_reminder_interval_minutes` | `15` | Minimum gap between wrap-up nudges per session. |
| `override_phrase` | `wiem, override` | Phrase user can include in any prompt to bypass blocks (the only escape from the sleep phase). |
| `language` | `pl` | Reserved for future i18n. v2 is Polish-only. |
| `time_marker_interval_minutes` | `20` | If no plugin output reached this session for N minutes, emit a `<dopadone event="time-marker" date="YYYY-MM-DD" time="HH:MM"/>` so Claude knows the current wall-clock date and time. Set to `0` to disable. |
| `interrupt_lease_ttl_minutes` | `60` | Cross-session lease for a habit reminder. The first chat to emit it holds the lease; other chats stay silent until the owner takes another turn or the lease expires. Applies only in work/wrap-up habit phases. Set to `0` to let another chat take over immediately. |

To reconfigure later: edit `~/.claude/settings.json` directly or re-run the plugin install flow.

## How the probability is computed

> **Single source of truth (#283).** The phase classifier, this interrupt-probability
> model, the focus-habit picker, and the `agenda` wire contract all live in
> [`@dopadone/core/habits`](https://github.com/cielecki/dopadone) — the same engine the
> `dopadone` CLI uses. The plugin imports them (bundled into `bin/*.cjs` via the build
> alias) rather than carrying its own copy, so the math can't drift between the CLI and
> the plugin. What stays plugin-local is the irreducibly hook-shaped glue: the directive
> copy, the `<dopadone>` XML emission, the `$CLAUDE_PLUGIN_DATA` state files, the
> routine-gate transcript scan, and the OS notifications.

The blocking-interrupt probability combines the (orthogonal) habit channel with the phase baseline:

```
phase_baseline = {
  work:    0,
  wrapup:  0,                  # wrap-up uses a SEPARATE non-blocking channel
  evening: evening_intensity,  # default 70
  sleep:   100,                # forced — retry can't win
}

habit_urgency:
  in-window habit  →  lingerProgress × (priority/4) × 50      # caps ~50 at end
  linger=0 habit   →  priority × 3                            # low constant
  (missed-today habits are inert — never drive interrupts)

P = max(phase_baseline, habit_urgency)
    capped at 99 for work / wrap-up / evening   (retry stays an escape valve)
    forced to 100 for sleep                     (only the override phrase escapes)
```

Roll `RANDOM % 100`, block if roll < P. Empty agenda → silent (fail-safe). During work, `phase_baseline` is 0 so only habits can fire — no sleep pressure. The **wrap-up non-blocking nudge** is a separate roll: gated by `wrapup_reminder_interval_minutes` cadence, then `wrapup_intensity` % chance.

## In-chat command grammar

Once the plugin is active, Claude recognises these phrases and routes them to `dopadone habits …` via Bash. Polish + English variants both work (fuzzy match — voice transcription mangles things):

| Phrase | Action |
|---|---|
| "obiad jem" / "jem obiad" / "po kolacji" | `dopadone habits done <id>` |
| "obiad za 30 min" / "X odłóż 1h" | `dopadone plan move <id> <HH:MM>` (a plan-level move; the deprecated `habits snooze` was removed in #281 — `plan add <id>` first if it isn't on today's plan) |
| "cisza 2h" / "mute do 22:00" | `dopadone habits mute --until <duration> --reason "..."` |
| "unmute" / "znów przypominaj" | `dopadone habits unmute` |
| "skip obiad" / "odpuść obiad dziś" | `dopadone habits decline <id>` |

## State files

The plugin writes a few small files under `$CLAUDE_PLUGIN_DATA` (defaults to `~/.claude/state/` when running outside a plugin context):

- `health-rhythm-retries.txt` — retry counter for escalating interrupt copy (mentions override at 3x, mute at 5x, "this is my bug" at 10x)
- `health-rhythm-hook.log` — append-only log of every emitted JSON, for debugging
- `health-rhythm-notif.txt` — per-boundary hourly dedup key for the Notification hook
- `last-inject-<session_id>.txt` — unix timestamp of the last plugin output for this Claude session; gates the time-marker so it doesn't fire too often
- `last-wrapup-<session_id>.txt` — unix timestamp of the last wrap-up nudge for this session; enforces the `wrapup_reminder_interval_minutes` cadence
- `interrupt-claim-<habit-id>.txt` — cross-session lease recording which chat currently owns a habit reminder and when it claimed it
- `routine-session-<session-id>.txt` — marks a scheduled/routine session so later turns in it remain silent
- `override-quiet-<session-id>.txt` — expiry time for a session's temporary evening/sleep override window

All are gitignored / ephemeral.

## Disabling

Temporarily, without removing the plugin:

```bash
dopadone habits mute --until tomorrow --reason "wakacje"
```

Permanently: remove `~/.claude/skills/dopadone` for the `@skills-dir`
installation, or run `claude plugin uninstall dopadone@dopadone` for a
marketplace installation.

## Development

```bash
git clone https://github.com/cielecki/dopadone
cd dopadone/plugins/dopadone
# The hooks import @dopadone/core/habits, bundled in from core's prebuilt dist.
# Build core FIRST (sibling checkout) so dist/habits.mjs exists for the alias:
pnpm --filter @dopadone/core build   # run from the dopadone repo
pnpm build                            # rebuild bin/*.cjs (esbuild --alias:@dopadone/core/habits=…)
pnpm test                             # vitest resolves the same alias (see vitest.config.ts)
pnpm build:smoke && pnpm smoke        # seam check: bundle stays calendar-/node-free
# Validate plugin manifest:
claude plugin validate .
```

Version history lives in the `git log` on `main` — the commit history is the changelog.

## License

MIT — see [LICENSE](LICENSE).


## Codex behavior

Version 2.10.0 exposes two shared surfaces in Codex: the `do` skill and the
time-awareness path from the same compiled user-prompt bundle Claude uses. The
Codex manifest sets `DOPADONE_REMINDERS_ENABLED=false`, so an eligible prompt can
inject only:

```xml
<dopadone event="time-marker" date="YYYY-MM-DD" time="HH:MM"/>
```

The marker is emitted at most once per task in the configured interval (20 minutes
by default). This path returns before the DopaDone CLI or reminder logic runs.
Habit reminders, wrap-up nudges, evening/sleep refusals, and OS notifications remain
Claude-specific.

Codex 0.153.4 supports this inline hook declaration (verified against its release
loader, native install, and `hooks/list`). Older bundled scaffolding validators may
reject the field despite the native runtime accepting it. Do not remove the inline
declaration: omitting it enables default discovery of Claude's complete
`hooks/hooks.json`. Plugin hooks require a one-time trust review in Codex `/hooks`,
and a new task is required after installing or changing a hook.

Configure `DOPADONE_DO_CONFIG`, use the shared XDG path documented in
`skills/do/config.template.md`, or retain existing Claude plugin-data configuration.
The helper reads the file explicitly; neither Markdown links nor command snippets
are automatic imports. Test the resolver with
`node --test skills/do/scripts/test-read-config.cjs`.

Source checks (2026-09-15):
- https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core-plugins/src/loader.rs
- https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core-plugins/src/manifest.rs
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/skills
- https://code.claude.com/docs/en/skills
