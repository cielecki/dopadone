# Claude Code

The shared workflow uses Claude's shell, file and skill tools. The configuration
helper honors `CLAUDE_PLUGIN_DATA/do/config.md` first after an explicit override,
then shared configuration and the existing legacy plugin-data locations.

The plugin's existing health-rhythm hooks remain Claude-specific and unchanged.
Configuration is now read explicitly at invocation; no bang-command preprocessing
is required. Read the helper output before picking or researching a task.
