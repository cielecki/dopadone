#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function readConfig(env = process.env, home = os.homedir()) {
  const explicit = env.DOPADONE_DO_CONFIG;
  const candidates = explicit ? [explicit] : [
    env.CLAUDE_PLUGIN_DATA && path.join(env.CLAUDE_PLUGIN_DATA, "do/config.md"),
    path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "dopadone/do/config.md"),
    path.join(home, ".claude/plugins/data/dopadone/do/config.md"),
    path.join(home, ".claude/plugins/data/dopadone-skills-dir/do/config.md"),
  ].filter(Boolean);
  for (const filename of candidates) {
    try { return fs.readFileSync(filename, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT" && !explicit) continue;
      throw new Error(`Cannot read DopaDone configuration at ${filename}: ${error.code}`);
    }
  }
  return "(No personal config yet. Use CLI-only defaults: no substrate skills, extra research tooling, or custom roots.)\n";
}
module.exports = { readConfig };
if (require.main === module) {
  try { process.stdout.write(readConfig()); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
