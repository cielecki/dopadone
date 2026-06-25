# do — editor notes

Auto-loaded when Claude works inside this directory. Not loaded at skill invocation.

## Architecture overview

This skill is a thin Claude Code wrapper around the `dopadone` CLI. The CLI handles vault I/O,
weight computation, and mutations. Claude handles judgment: which task fits the moment, what the
concrete first action is, how to collaborate, when to ask before doing.

Design conclusion: the meta-skill `do` is the right home for cross-substrate task lifecycle;
substrate tooling (Todoist, calendar, etc.) stays focused on substrate CRUD. The skill loads
substrate tooling cross-skill rather than duplicating its API recipes inline — eliminates drift
risk.

**Personalization split.** The generic workflow lives in `SKILL.md`; per-user setup (which
substrate tooling, research roots, conventions) lives in a config file injected at runtime via
`` !`cat "${CLAUDE_PLUGIN_DATA}/do/config.md"` ``. The shipped `config.template.md` is
the placeholder; users copy it into their plugin data dir. This keeps the public skill free of
any one user's private paths, tokens, contacts, or skill names.

Two entry variants share one workflow body:
- **Pick entry** (no task specified): slot-machine — pick from pool, dent, auto-continue.
- **Named entry** (task identified): focus mode — work on the one named, no auto-continue.

The body (research → brief → propose → iterate → execute → record) is identical regardless of
entry. The split affects only Step 1 (parse), Step 3 vs Step 4 (pick vs resolve), Step 5
(bare-URL ask gate for 1c), and Step 10 (auto-loop vs stop).

## Why no AskUserQuestion

Plain prose recommendations beat the chip-picker UI — clicking ≠ thinking, and the meta-options
just visually formalize a reply a one-word text answer covers fine. Applied to Steps 5 (bare-URL
ask), 7 (action approval), and 9 (outcome recording).

## Why single recommendation, not a menu

A menu just relocates the decision friction — picking between 4 options is exactly as stalling
as picking from scratch. The 7 ADHD patterns are an *internal* scoring rubric: enumerate
candidates in your head, commit to ONE, present it with a transparency note about which pattern
you used.

## Why auto-loop in pick-entry only

Step 10 auto-loops back to a fresh pick after any pool-mutating outcome — the slot-machine keeps
the lever pulling itself, removing the manual re-invoke friction between dents. Named-entry stays
single-shot — it's deep work on a specific thing, not a slot-machine rotation.

## Why `dopadone pick` is sampled, not ranked

`dopadone pick --top N --json` draws N weighted-random samples without replacement (the same
sampler the desktop/mobile apps use), not a deterministic top-N sort — otherwise every dent
would replay the identical 5 candidates in the same order until the pool mutated. The
`probability` field is the prior weight share over the full filtered pool (chance of being drawn
first), not share of the sampled subset.

## Why the related-task scan (Step 5)

The Inbox often holds a fresher duplicate of whatever just got picked; doing the picked task
without merging first wastes the dent. The scan feeds both the briefing (a "Related" subsection)
and Step 6's recommended action shape — merge-first, batch, re-order.

## Why the Step 8 anti-duplicate guard

Hub-tasks often hide under non-obvious titles; the obvious-noun search returns 0 hits while a
synonym search finds the real hub. Rule: for any domestic / errand / chore task, try synonyms
(object + action + location + person handling) before creating a new task — if a hub with
comments exists, comment on it instead.

## Why the maintenance-label snooze defaults to tomorrow

Recurring-hygiene tasks (inbox-zero series, daily routines) need a daily snooze cadence, not
weekly. `nextweek` is reserved for genuinely week-stable things (waiting on a slow reply that
won't come sooner). The label that marks these is user-configured (see config).

## Why the clickable-link HARD RULE

Missing-link slips break the slot-machine UX because the user can't 1-click back to the task to
verify / edit it. The rule explicitly covers follow-up messages in the same dent, not just first
mentions. HARD RULE 2 (phone-number resolution for messaging contacts) is gated on the user
having contact-resolution tooling configured.

## Reference files

- `references/output-links.md` — per-source-type URL formats for clickable task links (Step 3–9)
- `references/adhd-patterns.md` — the 7 ADHD prompt patterns + Defer-with-scaffolding + how-to-pick + worked example (Step 6 internal rubric)
- `references/e2e-check.md` — manual install verification commands (one-time, post-install)
- `config.template.md` — the per-user personalization template (copy to `${CLAUDE_PLUGIN_DATA}`)
