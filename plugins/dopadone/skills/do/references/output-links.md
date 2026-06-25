# /do — output conventions for clickable task links

Cards are read in the terminal and clicked through to open tasks in their native apps. Always
format task references as markdown links, never as bare titles or IDs. Apply this everywhere a
task appears: the Picked card (Step 3), the briefing (Step 5), the recommendation (Step 6), the
outcome confirmation (Step 9). If you mention a *different* task in passing (e.g. "see also task
X"), link it the same way.

## URL formats by source type

| Source type | URL format | Example |
|---|---|---|
| `todoist` | `https://app.todoist.com/app/task/<id>` | `[Call the clinic](https://app.todoist.com/app/task/6Xy9aBcDeFgHiJkL)` |
| `github` | Use `ext.html_url` if present, else `https://github.com/<owner>/<repo>/issues/<n>` | `[Fix login bug](https://github.com/owner/repo/issues/42)` |
| `markdown` | Use the file path with optional line: `<filePath>` or `<filePath>:<line>` | `[meeting notes](notes/2026-05-22.md)` |
| `calendar` | Use `ext.htmlLink` if present, else skip linking | `[Performance review](https://calendar.google.com/event?eid=...)` |
| `habit` | No URL — habits are vault-internal. Just print the title plain. | `15 minutes to notice your mental resources` |

## Rule of thumb

Any time you write a task ID like `6Xy9aBcDeFgHiJkL`, ask yourself "can the user click this?"
If no — wrap it.
