"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {readConfig} = require("./read-config.cjs");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dopadone-config-"));
  t.after(() => fs.rmSync(home, {recursive:true, force:true}));
  const write = (p, text) => {fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p,text);return p;};
  return {home, write};
}
test("explicit file wins over host and shared locations without changing content",t=>{
  const {home,write}=fixture(t); const chosen=write(path.join(home,"my config.md"),"chosen");
  write(path.join(home,"data/do/config.md"),"host");
  assert.equal(readConfig({DOPADONE_DO_CONFIG:chosen,CLAUDE_PLUGIN_DATA:path.join(home,"data")},home),"chosen");
  assert.equal(fs.readFileSync(chosen,"utf8"),"chosen");
});
test("missing explicit file fails rather than silently adopting another profile",t=>{
  const {home,write}=fixture(t);write(path.join(home,".config/dopadone/do/config.md"),"shared");
  assert.throws(()=>readConfig({DOPADONE_DO_CONFIG:path.join(home,"missing")},home),/ENOENT/);
});
test("Claude keeps its configured profile before shared profile",t=>{
  const {home,write}=fixture(t);const data=path.join(home,"plugin-data");
  write(path.join(data,"do/config.md"),"claude");write(path.join(home,".config/dopadone/do/config.md"),"shared");
  assert.equal(readConfig({CLAUDE_PLUGIN_DATA:data},home),"claude");
});
test("Codex can use XDG configuration without Claude variables",t=>{
  const {home,write}=fixture(t);const config=path.join(home,"xdg");write(path.join(config,"dopadone/do/config.md"),"xdg");
  assert.equal(readConfig({XDG_CONFIG_HOME:config},home),"xdg");
});
test("legacy directory installation retains its private configuration",t=>{
  const {home,write}=fixture(t);write(path.join(home,".claude/plugins/data/dopadone-skills-dir/do/config.md"),"legacy");
  assert.equal(readConfig({},home),"legacy");
});
test("new user gets CLI defaults without creating state",t=>{
  const {home}=fixture(t);assert.match(readConfig({},home),/CLI-only defaults/);assert.deepEqual(fs.readdirSync(home),[]);
});
test("a non-file profile errors rather than falling through",t=>{
  const {home}=fixture(t);fs.mkdirSync(path.join(home,".config/dopadone/do/config.md"),{recursive:true});
  assert.throws(()=>readConfig({},home),/EISDIR/);
});
