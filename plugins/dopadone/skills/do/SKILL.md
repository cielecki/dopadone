---
name: do
description: |
  Work on ONE task — either pick from DopaDone's unified pool (Todoist + markdown +
  habits + Google Calendar + GitHub) via the slot-machine, OR work a specific named
  task you point to (URL, ID, or title fragment). Workflow: research → brief → propose
  ONE action → iterate → execute → record outcome via the `dopadone` CLI. Auto-continues
  only in pick mode. Pick triggers: "/do", "what now", "pick me a task", "what should I
  work on", "make some progress". Named triggers: "/do <id-or-url>", "let's work on X".
  A bare task URL with no instruction → read + ask before working.
author: DopaDone
version: 2.0.0
date: 2026-06-25
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Skill
---

# /do — work on one task (pick or named)

This skill is a thin Claude Code wrapper around the `dopadone` CLI. The CLI handles vault
I/O, weight computation, and mutations. Claude handles judgment: which task fits the
moment, what the concrete first action is, how to collaborate, when to ask before doing.

Two entry variants share one workflow:
- **Pick entry** (no task specified): slot-machine — pick from pool, dent, auto-continue.
- **Named entry** (task identified): focus mode — work on the one you named, no auto-continue.

The body of the workflow (research → brief → propose → iterate → execute → record) is
identical regardless of entry.

## Your configuration

This skill is generic; your personal setup (which substrate tooling to use per source,
where to research, your conventions) lives in a config file that is injected below at
runtime. If it shows the template placeholder, copy `config.template.md` (shipped beside
this skill) to `${CLAUDE_PLUGIN_DATA}/do/config.md` and fill it in — the skill
still works without it, just with no source-specific tooling or research roots.

!`cat "${CLAUDE_PLUGIN_DATA}/do/config.md" 2>/dev/null || cat "$HOME/.claude/plugins/data/dopadone/do/config.md" 2>/dev/null || echo "(no personal config yet — see config.template.md beside this skill. Proceeding with CLI-only defaults: no substrate skills, no extra research tooling, no custom research roots.)"`

Throughout the workflow, where a step says "your configured X", it means the matching
section of the config above. When the config is absent, fall back to the generic default
named in the step (usually: use the CLI + `gh` + the Read tool directly, skip the extras).

## Prerequisites

The `dopadone` binary must be on PATH. Verify with `which dopadone`. If missing, install
it per your config's "CLI location" section (or the dopadone repo's build instructions). If
the build fails, surface the error — the user needs a working CLI before continuing.

## Workflow (run in order — entry variant determines branches at steps 1, 2/3/4, 5, and 10)

### Step 1 — Entry: parse what brought us here

Identify `source_type` and `id` as early as possible (informs whether to load a substrate
skill at step 2).

| Entry variant | When | Action |
|---|---|---|
| **1a — Pick (no task)** | `/do` alone, "what now", "pick me one", "make some progress", "what should I work on" | Set `entry=pick`. `source_type` and `id` are UNKNOWN now — set by step 3's pick result. Skip step 2. |
| **1b — Named explicit** | `/do <id-or-url-or-fragment>`, "let's work on X", "start on X" | Set `entry=named-explicit`. Extract `source_type` + `id` from the identifier (see resolution table). If the identifier is a title fragment, `id` remains unknown until step 4. |
| **1c — Bare URL paste** | Message contains only a Todoist / GitHub URL and nothing else signalling action intent (no "let's work on", no explicit verb) | Set `entry=bare-url`. Extract `source_type` + `id` from URL pattern. Set a flag for step 5 to ask before continuing. |

**Identifier resolution table (for entry 1b):**

| Identifier shape | `source_type` | How to get `id` |
|---|---|---|
| `https://app.todoist.com/app/task/...` | `todoist` | Last segment after final `-`; or the whole last segment if no dashes |
| `https://github.com/<owner>/<repo>/issues/<n>` | `github` | `owner/repo#n` |
| Bare alphanumeric ID (~16 chars) + a substrate hint in context | as hinted | Direct |
| Title fragment (free text after "work on") | unknown until step 4 | Search at step 4 |

For pick entry (1a), the user may pass a focus-mode hint like `/do focus=work`. Resolve it
via `dopadone focus-modes --json` (match case-insensitively against `name` or `id`); pass to
step 3 as `--focus-mode <id>`. If ambiguous, ask. If no match, ignore.

### Step 2 — Substrate prep: load the substrate tooling if source_type is known

If `source_type` is known AND your config names dedicated tooling for it, load that NOW
(before any substrate API call).

| `source_type` | Action |
|---|---|
| `todoist` | If your config names a Todoist skill/tooling, load it once (auth, REST + sync recipes, date semantics, pitfalls enter context). Use those recipes for all subsequent Todoist read + mutate. Otherwise use the Todoist REST API directly with a token from your environment. |
| `github` | Use `gh issue view <n>` / `gh pr view <n>` directly. |
| `markdown` / `habit` / `calendar` | Use inline recipes (Read tool for markdown, `dopadone` CLI ext data for habits, your configured calendar tooling or inline for calendar). |

If `source_type` is unknown (entry 1a, or 1b with title fragment), SKIP step 2. The substrate
will be known by step 3 (pick) or step 4 (resolve), and the substrate tooling loads there
before any substrate API call.

### Step 3 — Pick (entry 1a only): get a candidate from the pool

Track a session-scoped timestamp of the last `dopadone refresh`. If >60s ago (or first
invocation), run `dopadone refresh`. Then fetch candidates:

```bash
dopadone pick --top 5 --json
```

(Add `--focus-mode <id>` if step 1 resolved one.)

Parse the JSON. Schema:

```json
{
  "candidates": [
    {
      "id": "string",
      "title": "string",
      "source": "string (instance id, e.g. todoist or markdown-1)",
      "source_type": "string (todoist | markdown | habit | calendar | github)",
      "weight": 12.34,
      "probability": 0.18,
      "labels": ["tag:foo", "project:bar", "priority:p2"],
      "body": "optional task body / description",
      "priority": 1,
      "start_date": "ISO date or null",
      "deadline_date": "ISO date or null",
      "added_at": "ISO timestamp",
      "updated_at": "ISO timestamp",
      "weight_breakdown": { ... },
      "ext": { ... }
    }
  ],
  "total_pool_size": 47,
  "focus_mode": { "id": "work", "name": "Work" } | null
}
```

If `candidates.length === 0`: print "no tasks available," note their focus mode may have
filtered everything out, exit.

**Pick ONE candidate** using context (local time + day-of-week via `date`, cwd via `pwd`,
recent commits via `git log -3 --oneline 2>/dev/null` if cwd is a git repo, the user's mood
hint if any, active focus mode name).

Print a compact card. Make the title a clickable link per [references/output-links.md](references/output-links.md):

```
Picked: [<title>](<source-specific URL>)
Source: <source_type> (<source>)
Why: <reasoning>
Weight: <weight> (probability <pct>%)
Labels: <tag: / project: / file: labels only — hide system criteria>
```

Set `source_type` and `id` from the picked candidate. If a substrate tooling is configured
for `source_type` and not yet loaded → load it now.

### Step 4 — Resolve (entry 1b title-fragment only): find the named task

When entry 1b passed a title fragment ("let's work on the X task"), resolve to a concrete task:

1. Search your task sources — use your configured Todoist (or other source) search tooling.
   If none is configured, use the source's API/CLI directly (e.g. the Todoist REST filter
   endpoint, `gh issue list --search`).
2. If the cwd suggests sibling markdown tasks (e.g. inside a DopaDone vault), Read the
   candidate file(s) for matching task lines.
3. If 1 match → use it. If 0 matches → ask for a more specific name. If multiple → surface a
   numbered list with clickable links, ask for one-word disambiguation.

Once resolved, set `source_type` and `id`. Load the substrate tooling if configured.

### Step 5 — Research the task (and brief, then ask if entry 1c)

Research is **free** — it has no side effects on the world or the vault. Do it without asking.

For the picked/named candidate, automatically gather everything cheap that helps you propose
better options:

| `source_type` | Auto-run |
|---|---|
| `todoist` | Pull task body + comments via your configured Todoist tooling (or the REST API). Keep each comment's timestamp. Don't trust `note_count` if your tooling flags it unreliable. |
| `markdown` | `Read` the file at `ext.filePath`. The task body alone is usually a stub. |
| `habit` | No extra research needed; print the habit description. |
| `calendar` | If the event has location/attendees/notes in `ext`, surface them. |
| `github` | `gh issue view <n>` or the equivalent GitHub API call. |

**Follow leads anywhere — the table above is the baseline.** If the task body or comments
mention something you can read with zero side effects (an email subject, file path, URL,
person, project, portal), go fetch it. These are allowed and should NOT trigger an "is this
OK?" ask. Use whatever of these your config enables (skip any it doesn't):

- **Email search** — if your config names email tooling, use it whenever the task references
  a message, newsletter, sender, or admin correspondence (including reading PDF attachments).
- **Local file search / grep** under your configured research roots, or any project subtree.
- **Reading sibling files** beyond the one at `ext.filePath` if context lives nearby.
- **Web fetches** of the obviously-next URL (portal, weather, public schedule).
- **Querying other connectors directly** (a calendar event for a related meeting, a GitHub
  issue mentioned in a Todoist task, comments on a different task).
- **Reading PDFs / images** referenced anywhere reachable.
- **Messaging context** — if your config names messaging tooling and the task touches a
  thread/contact (title or labels mention a messenger, comments reference a thread, or it
  names a person you correspond with), read the relevant thread via that tooling before
  drafting any reply. Reading the thread before drafting is mandatory — don't propose a reply
  off the task title alone. If your messaging tooling exposes a freshness signal, surface it
  and refresh first when stale.

Rule: if the action is read-only and helps you propose a sharper first action, do it. The
only forbidden thing is *mutations* — those go in Step 8 after approval.

#### Related-task scan (Todoist) — always run during research

The picked/named task rarely lives alone. There's often a fresh Inbox capture, a separately
logged "follow up with X", or a duplicate. Always scan Todoist for these in parallel (fire
all API calls in one batch):

1. Extract **2–4 scan keys**: person name(s), vendor/company, project label, file path
   basename, URL host, distinctive noun. Skip generic verbs.
2. **Inbox sweep**: fetch the whole Inbox (small). Grep client-side for scan keys.
3. **Project-wide sweep**: for each scan key ≥3 chars, run a Todoist `search:` filter. Merge,
   dedupe, drop the current task's id.
4. **Filter** to matches sharing a person name, an exact noun ≥4 chars in both titles, a
   project label, or a referenced URL host. Drop generic-word hits.
5. Cap at **5 related tasks**. If more matched, keys were too generic — narrow.

What to do with findings:
- **0 found** — say nothing.
- **1–5 found** — add a "Related" subsection to the briefing with each as a clickable Todoist
  link + half-line tag: `same person · Inbox · 2d old`, `downstream — finishes after this`,
  `likely duplicate`, `same portal login`, etc.
- Let the relation **change Step 6's recommended action**:
  - **Merge-first**: if a duplicate exists, recommended action = "merge Inbox capture `<id>`
    into this task's body, delete the duplicate, then do the real work."
  - **Batch**: recommend doing both together.
  - **Re-order**: if an upstream blocker exists, target the blocker.
  - **None of the above** — surface for awareness, proceed with the original recommendation.

#### Briefing — print to user

After research, print a compact briefing. **First line is the Picked card** (entry 1a) or
the **task card** (entry 1b / 1c):

```
Picked: [<title>](<source-specific URL>)
Source: <source_type> (<source>)
Why: <reasoning>   <-- entry 1a only
Weight: <weight> (probability <pct>%)   <-- entry 1a only
Labels: <tag: / project: / file: labels only — hide system criteria>
```

Then below it:
- **Created / last updated** as relative time. If both within a day and recent, say "fresh —
  created today." If `updated_at` much newer than `added_at`, note it. Omit cleanly if null.
- Task body (truncated to ~500 chars if long)
- Chronological comments — each prefixed with relative `posted_at` (`[3d ago]`, `[Mon 14:02]`,
  `[2026-03-04]` for >2 weeks). Body truncated to ~300 chars.
- Any URL mentioned, formatted as a clickable link
- **Related tasks** subsection (omit if scan returned 0)
- One-line synthesis: *"Context = X. The hard ask is Y. Time pressure = Z."* If the scan
  changed your recommendation shape, call it out.

**Use the timestamps when synthesizing** — a fresh task is a fresh capture; a stale task may
need "re-check the situation" rather than the literal next step. Let this shape Step 6.

**HARD RULE: every time the task is named in user-facing output — the Picked card, the
briefing, the Step 6 recommendation, re-recommendations after pivots, the Step 9 outcome line,
ANY follow-up message in the same dent — the title (or any naming reference like "the task",
"this one") MUST be wrapped as a clickable markdown link to its source URL.** Per-source URL
formats in [references/output-links.md](references/output-links.md). Missing-link slips break
the slot-machine UX because the user can't 1-click back to the task to verify / edit it. If
you're about to write the task name in plain text, STOP and wrap it.

**HARD RULE 2 — messaging contacts (if your config enables contact resolution): resolve phone
numbers to contact names AND wrap as a clickable deeplink.** When a briefing references a
person via a phone handle, do both before printing: (1) resolve the number against your
configured contacts tooling, showing resolved name + raw number side by side; (2) wrap the
display name as a clickable deeplink per your config's linking conventions. For groups: plain
text `group: <names>` with `⚠️ open manually` (no group deeplink). For unsaved numbers: show
the bare number, still wrap as a link. Skip this rule entirely if no contact tooling is
configured.

#### Entry 1c (bare-URL) ASK GATE — ask before continuing past briefing

If `entry === "bare-url"`: after the briefing, append one line:

> Want to work on it? **(yes / skip / just looking)**

End your turn. Wait for the user's plain-text reply.

| Reply | Next |
|---|---|
| "yes" / "ok" / "let's go" | Continue to Step 6 (propose action) |
| "skip" / "leave" / "drop" | Exit the skill, no outcome recorded |
| "just looking" / "info only" | Exit the skill, no outcome recorded |
| Anything else | Treat as discussion, answer their question, then re-ask |

For entry 1a (pick) and entry 1b (named-explicit), DO NOT ask. Proceed directly to Step 6.

### Step 6 — Propose ONE concrete action

**Present a single recommended action. Not a menu.** This applies to BOTH entry variants. A
menu of 3–4 options re-introduces exactly the decision friction this skill removes. The
pattern is: *we* pick, the user gets one clear "do this" line, they accept / modify / skip.

That doesn't mean think shallowly. Internally enumerate 2–4 candidate actions using the 7
ADHD prompt patterns, score them against the moment (time of day, energy hint, task type,
deadline pressure, what the user just finished, the related-task findings), then **commit to
one**. The user only sees the winner; the deliberation stays in your head.

Internal scoring rubric: see [references/adhd-patterns.md](references/adhd-patterns.md) for
the 7 ADHD prompt patterns + the **Defer-with-scaffolding** meta-pattern + how-to-pick
guidance + a worked example. Score candidates on fit / friction floor / context signals;
commit to ONE action; write it as a single imperative sentence with the exact tangible target
(file path, phone number, sentence to read, app to open). Note the pattern in parentheses for
transparency. No menu.

### Step 7 — Wait for the user's reply in plain text

**Do NOT use AskUserQuestion.** Plain prose recommendations beat the chip-picker UI — clicking
≠ thinking, and the meta-options just visually formalize a reply a one-word text answer covers.

After printing the recommendation (Step 6), end your turn. No prompt suffix, no "let me know
which one" coda, no menu. The recommendation itself implies the possible replies.

Expected replies (interpret loosely):

| Reply pattern | Interpretation | Next step |
|---|---|---|
| "yes" / "do it" / "go" / "ok" / silence + new request | Approved | → Step 8 (Claude executes) |
| "I'll do it" / "manual" | User handling | → Step 9 (record outcome) |
| Counter-proposal ("instead let's …") | Modify | Adopt redirection → Step 8 with modified action |
| "skip" / "next" | Re-roll (pick-entry only — see note) | → Step 3 with same 5 candidates minus this one (max 2 re-rolls per invocation). For named-entry (1b/1c), "skip" exits the dent without recording an outcome. |
| Question or pushback | Discuss, then re-recommend | Stay in Step 7 |

If your internal scoring strongly suggested defer-with-scaffolding (energy is wrong, context
is wrong, deadline is far), make THAT the recommended action in Step 6 — don't bury it.

### Step 8 — Execute (if approved)

Do the work. Use available tools (Bash, Edit, Write, Read). Stay focused: **stop when the
proposed first action is done.** Do NOT keep going into "while I'm here, let me also…". One
dent, one task. If the work creates artifacts (draft files, scratch notes), mention paths.

For Todoist mutations (close, comment, re-date, snooze), use your configured Todoist tooling —
it's already in context from Step 2/3/4. Don't duplicate API recipes inline.

**Anti-duplicate guard — before creating ANY Todoist task in Step 8, search ≥3 synonyms.**
Hub-tasks often hide under non-obvious titles (e.g. a "sell the old X" task may live under a
broader "coordinate the new-X purchase and old-X removal" hub with many comments). Searching
the obvious noun alone returns 0 hits; trying synonyms (object + action + location + person
handling) finds it. **Rule:** for any "domestic / errand / chore" task, try synonyms before
creating. If a hub with comments exists → add a comment with the update, do NOT create a new
task.

### Step 9 — Record outcome (plain prose, no AskUserQuestion)

After Step 8 finishes (or the user says they did it manually), print a one-line outcome menu
and wait for the plain reply. **Do NOT use AskUserQuestion.**

Print exactly:

```
Outcome? **progress** (default, with note) · **done** · **snooze hour/tomorrow/nextweek** · **delete** · **leave**
```

Then end your turn. Interpret the reply:

| Reply | CLI call |
|---|---|
| "progress" / "p" / silence + "next" | `dopadone progress <id> --note "<one-line summary of what just happened>"` |
| "done" / "d" | `dopadone done <id> --note "<summary>"` |
| "snooze hour" / "hour" | `dopadone snooze <id> --until hour` |
| "snooze tomorrow" / "tomorrow" | `dopadone snooze <id> --until tomorrow` |
| "snooze nextweek" / "nextweek" | `dopadone snooze <id> --until nextweek` |
| "delete" | `dopadone delete <id>` |
| "leave" / "skip" | No CLI call |

Where the `--note` lands depends on the source: Todoist and GitHub post it as a comment on
the task/issue; habit and calendar record it locally. Markdown and claude-desktop sources
have no note target — `dopadone progress` still succeeds (exit 0) but prints
`note not written back`; that's expected, keep the summary in the chat and move on.

If your config defines a maintenance label (e.g. an "ongoing"/recurring-hygiene label), its
default snooze is `tomorrow`, NOT `nextweek` — daily hygiene, not weekly. Reserve `nextweek`
for things that genuinely won't change for a week (e.g. waiting on a slow reply).

**HABIT-SOURCE tasks need the `habits` subcommand — `dopadone done <id>` fails with `no task
matching` for them.** When `source_type === "habit"`, the outcome verbs map to a different
subcommand surface:

| Reply | Habit-source CLI call |
|---|---|
| "done" | `dopadone habits done <habit-id>` |
| "snooze 30min" / "snooze HH:MM" | `dopadone plan move <habit-id> <HH:MM[-HH:MM]>` — defer a habit via a plan-level move (run `dopadone plan add <habit-id>` first if it isn't on today's plan) |
| "skip today" / "decline" | `dopadone habits decline <habit-id>` |
| "mute reminders" | `dopadone habits mute --until <dur>` (silences ALL habit reminders globally; `dopadone habits unmute` to restore) — not per-task |

If the reply is ambiguous (e.g. "snooze" without a duration), ask one quick clarifying
question in prose. Always use the exact task ID set during Step 1 / 3 / 4. Never a fragment.
Print a one-line confirmation after the CLI call: `Recorded: progress` / `Done: <title>` /
`Snoozed until <duration>: <title>`.

### Step 10 — Continue? (depends on entry variant)

After Step 9 records an outcome, the next move depends on how this dent started.

**Pick entry (1a):** AUTO-LOOP back to Step 3 (fresh pick). This is the slot-machine — the
lever keeps pulling itself until the user steps away. Print a one-line transition before
refreshing, e.g. `→ next pick…`, so the user can see the loop and interrupt if needed.

**Exit conditions for the auto-loop** (stop, don't continue):
- User explicitly says stop / enough / pause / break / end. Interpret loosely.
- Outcome was `leave` (no mutation, no progress — would just churn).
- `dopadone pick` returns `candidates: []` (pool empty under current focus).
- User shifts topic entirely — read the room, exit gracefully.
- 6 consecutive auto-continues in one session → print "6 dents in a row, take a break or say
  `continue` to keep going" and pause until reconfirmed.

**Named entry (1b, 1c):** STOP. End the turn. Deep work on a named task is one dent, not a
loop. If the user wants another, they'll re-invoke explicitly.

A `skip` / `next` reply to a Step 6 recommendation is a re-roll WITHIN the current dent (Step 7
handles it), not an auto-continue trigger. Auto-continue only fires AFTER Step 9 records an
outcome, AND only when `entry === "pick"`.

## Error handling

| Failure | Behavior |
|---|---|
| `dopadone` not on PATH | Print install instructions (see Prerequisites). Stop. |
| CLI exits non-zero | Show stderr. If exit 2 (env error like vault locked), suggest retry. If exit 1 (user error), check the args. |
| `candidates: []` | Tell user no tasks available; maybe their focus mode filtered everything out. |
| AI picks an id not in candidates | Bug guard — fall back to the top weighted candidate and note the slip. |
| User cancels mid-execution (Ctrl-C) | Anything written stays. The mutation step hasn't happened yet, so the task is still in the pool. Tell user to re-run to record. |
| GitHub connector warning ("Invalid GitHub token") in stderr | Non-fatal; non-GitHub candidates still work. Mention once, proceed. |

## Don't

- Don't bypass the CLI and read the vault directly. The CLI is the contract; if it's broken, fix it.
- Don't pick from outside the 5 candidates the CLI returned (pick entry). They're already
  filtered + weighted; second-guessing the engine defeats the slot-machine psychology.
- Don't auto-mark-done after execution unless the work clearly completes the entire task.
  Progress is the default.
- Don't keep going past the proposed first action **within a single dent**. (After recording,
  Step 10 may auto-loop in pick-entry — that's the slot-machine, not "keep going past the action.")
- Don't ask 4 clarifying questions before picking. The whole point is to remove decision friction.
- **Don't ask before low-cost research.** Pulling comments, reading a file, fetching a URL —
  no side effects. Just do them.
- **Don't skip the related-task scan.** Even a self-contained-looking task often has a fresher
  Inbox duplicate or batchable sibling. Always run the scan (Step 5).
- **Don't use AskUserQuestion anywhere in this flow.** Plain prose + typed reply. Applies to
  Steps 5 (bare-URL ask), 7 (action approval), and 9 (outcome recording).
- **Don't present a menu of 3–4 actions.** Pick ONE and recommend it. The 7 ADHD patterns are
  an *internal* scoring rubric, not a UI element.
- Don't suggest abstract first actions ("think about X"). The recommended action must name a
  specific artifact, file, person, or sentence.
- **Don't pre-load substrate tooling speculatively.** Load it only when `source_type` is
  actually known (Step 3 for pick, Step 4 for title-fragment).
- **Don't auto-continue (slot-machine loop) in named entry.** Loop only after pick entry (1a).
- **Don't skip the bare-URL ask gate.** For entry 1c, ALWAYS pause at the end of Step 5 and ask
  before continuing — the user may have pasted the URL just to discuss or capture.

## First-run notes

See [CLAUDE.md](CLAUDE.md) for editor notes (architecture rationale, design history) and
[references/e2e-check.md](references/e2e-check.md) for the manual post-install check.
