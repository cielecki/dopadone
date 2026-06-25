# Manual E2E walkthrough — first-run check

After installing `dopadone` (see Prerequisites in `SKILL.md` / your config's "CLI location"),
run these three commands in order. They surface most install / vault / connector failures
without invoking the full skill workflow.

```bash
dopadone --help               # should print the command list
dopadone focus-modes          # should list at least one mode
dopadone pick --top 1 --json  # should return 1 candidate with weight_breakdown
```

If any of those fail, fix before invoking `/do` in anger.

## Common failure modes

| What broke | Likely cause | Fix |
|---|---|---|
| `dopadone: command not found` | Not on PATH | Build + link the CLI per your config's "CLI location" section |
| `dopadone --help` exits non-zero | Stale build after pull | Re-run the CLI build |
| `focus-modes` returns empty list | Vault missing or empty `focus-modes/` | Check vault path in `dopadone config` |
| `pick --top 1 --json` returns `candidates: []` | Active focus mode filtered everything out OR pool genuinely empty | Try without a focus override, or check the source (e.g. Todoist) directly |
| `pick` returns `candidates` but no `weight_breakdown` | CLI version too old (pre-timestamp fields) | Upgrade CLI |
