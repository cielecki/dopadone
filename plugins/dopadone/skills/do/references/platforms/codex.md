# Codex

Use the current host's shell/file tools and discover installed skills by capability.
Run the shared configuration helper before picking or researching a task. Codex does
not need Claude's bang-command syntax. Shared XDG configuration and the existing
legacy files work without relying on hook state.

This package exposes the explicit `do` workflow plus a deterministic
`UserPromptSubmit` time marker. The Codex adapter forces reminders off, so it never
fetches the DopaDone agenda or emits habit reminders, wrap-up nudges, sleep blocks,
or OS notifications. Do not claim those Claude-only behaviors are running or create
a substitute automation. The explicit pick/named-task workflow and its
approval/outcome boundaries still apply.
