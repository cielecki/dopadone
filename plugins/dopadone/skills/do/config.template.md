# /do — personal config

This file holds your personalization for the shared `do` workflow. The skill reads
it through `scripts/read-config.cjs` before any task work; it is not an automatic import.

For a new shared configuration, copy this file to
`${XDG_CONFIG_HOME:-$HOME/.config}/dopadone/do/config.md`, or set `DOPADONE_DO_CONFIG`
to an existing file. Existing `${CLAUDE_PLUGIN_DATA}/do/config.md` and legacy
`~/.claude/plugins/data/dopadone/do/config.md` and
`~/.claude/plugins/data/dopadone-skills-dir/do/config.md` locations remain readable.
Keep the
configuration outside the installed plugin so updates do not replace it.
Unfilled sections use CLI-only defaults.

Everything below is data the model reads as guidance. Keep it concise.

## CLI location

How to install / build the `dopadone` binary if it's missing from PATH. Example:

```
cd <path-to-dopadone>/apps/cli && pnpm build && npm link
```

## Substrate tooling (per source_type)

How to read + mutate each task source. Name the skill to invoke or the command to run. Leave a
source out to use the generic default (CLI + `gh` + Read tool).

- **todoist** — <e.g. invoke `Skill(<your-todoist-skill>)`; or use the Todoist REST API with a
  token from `<where your token lives>`. Name a search command for title-fragment resolution,
  e.g. `python3 <path>/search_tasks.py "search:<fragment>"`.>
- **github** — default: `gh issue view` / `gh pr view`. Override here if needed.
- **markdown** — default: Read tool on `ext.filePath`. Override here if needed.
- **calendar** — <your calendar tooling, or "inline from ext">.
- **habit** — default: `dopadone` CLI ext data.

## Research roots

Directories to grep / read during Step 5 research (free, read-only). Example:

```
~/projects/personal, ~/projects/work, ~/notes, ~/inbox
```

## Extra research tooling (optional — omit any you don't have)

- **Email search** — <command/skill to search + read your mail, incl. attachments; e.g.
  `python3 <path>/search_emails.py` / `read_email.py`. Used when a task references a message.>
- **Messaging** — <command/skill to read message threads (WhatsApp / iMessage / SMS / etc.) and
  a freshness signal if any. Used when a task touches a thread or a contact you message.>
- **Contacts resolution** — <how to resolve a phone number to a contact name (for HARD RULE 2),
  e.g. an Address Book / Contacts lookup. Omit to disable phone-number resolution.>
- **Linking conventions** — <where your clickable-deeplink scheme is documented, if you use one
  (e.g. an `im:` / `sms:` / `wa:` URL gateway). Omit for plain links.>

## Conventions

- **Maintenance label** — <a label marking recurring-hygiene tasks whose default snooze is
  `tomorrow` not `nextweek`, e.g. `@ongoing`. Omit if you don't use one.>
- **Anything else** — task-naming quirks, project labels that signal a domain, etc.
