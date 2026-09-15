# Claude Code

The shared workflow uses Claude's shell, file and skill tools. The configuration
helper honors `CLAUDE_PLUGIN_DATA/do/config.md` first after an explicit override,
then shared configuration and the existing legacy plugin-data locations.

The plugin's reminder and OS-notification surfaces remain Claude-specific and
unchanged; the time-marker path is also used by Codex with reminders forced off.
Configuration is now read explicitly at invocation; no bang-command preprocessing
is required. Read the helper output before picking or researching a task.
