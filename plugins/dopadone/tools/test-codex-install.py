import json
import os
import re
import selectors
import shutil
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path


def requests(home: Path, cwd: str, queries: list[tuple[str, dict]]) -> list[dict]:
    env = dict(os.environ, CODEX_HOME=str(home))
    process = subprocess.Popen(
        [os.environ.get("CODEX_BINARY") or shutil.which("codex"), "app-server"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
        cwd=cwd,
        bufsize=1,
    )

    def send(payload: dict) -> None:
        process.stdin.write(json.dumps(payload) + "\n")
        process.stdin.flush()

    def receive(expected_id: int) -> dict:
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            line = process.stdout.readline()
            if not line:
                raise RuntimeError("app-server exited")
            response = json.loads(line)
            if response.get("id") == expected_id:
                return response
        raise TimeoutError(expected_id)

    try:
        send(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {"name": "migration-verifier", "version": "1.0"},
                    "capabilities": {"experimentalApi": True},
                },
            }
        )
        receive(1)
        send({"method": "initialized", "params": {}})

        results = []
        for request_id, (method, params) in enumerate(queries, 2):
            send({"id": request_id, "method": method, "params": params})
            results.append(receive(request_id))
        return results
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def replay_time_hook(plugin_root: Path, plugin_data: Path) -> None:
    env = dict(
        os.environ,
        PLUGIN_ROOT=str(plugin_root),
        CLAUDE_PLUGIN_ROOT=str(plugin_root),
        PLUGIN_DATA=str(plugin_data),
        CLAUDE_PLUGIN_DATA=str(plugin_data),
        DOPADONE_REMINDERS_ENABLED="false",
        CLAUDE_PLUGIN_OPTION_DOPADONE_PATH="__must_not_run__",
    )
    hook_input = {
        "session_id": "codex-time-marker-test",
        "turn_id": "turn-1",
        "transcript_path": None,
        "cwd": str(plugin_root),
        "hook_event_name": "UserPromptSubmit",
        "model": "test-model",
        "permission_mode": "default",
        "prompt": "continue",
    }
    command = ["node", str(plugin_root / "bin" / "user-prompt.cjs")]

    first = subprocess.run(
        command,
        input=json.dumps(hook_input) + "\n",
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    envelope = json.loads(first.stdout)
    output = envelope["hookSpecificOutput"]
    assert output["hookEventName"] == "UserPromptSubmit", output
    match = re.fullmatch(
        r'<dopadone event="time-marker" date="(\d{4}-\d{2}-\d{2})" time="(\d{2}:\d{2})"/>',
        output["additionalContext"],
    )
    assert match, output
    assert match.group(1) == datetime.now().astimezone().strftime("%Y-%m-%d"), output
    assert first.stderr == "", first.stderr

    second = subprocess.run(
        command,
        input=json.dumps({**hook_input, "turn_id": "turn-2"}) + "\n",
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    assert second.stdout == "", second.stdout
    assert second.stderr == "", second.stderr


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[3]
    binary = os.environ.get("CODEX_BINARY") or shutil.which("codex")
    if not binary:
        raise SystemExit("Install Codex CLI first, or set CODEX_BINARY")

    with tempfile.TemporaryDirectory(prefix="dopadone-codex-test-") as tmp:
        home = Path(tmp)
        env = dict(os.environ, CODEX_HOME=tmp)
        for args in [
            ["plugin", "marketplace", "add", str(repo)],
            ["plugin", "add", "dopadone@dopadone", "--json"],
        ]:
            subprocess.run(
                [binary, *args],
                env=env,
                cwd=tmp,
                text=True,
                capture_output=True,
                check=True,
            )

        results = requests(
            home,
            tmp,
            [
                ("skills/list", {"cwds": [tmp], "forceReload": True}),
                ("hooks/list", {"cwds": [tmp]}),
            ],
        )
        for result in results:
            assert "error" not in result, result
            for row in result["result"]["data"]:
                assert not row.get("errors"), row
                assert not row.get("warnings"), row

        skills = [
            skill
            for row in results[0]["result"]["data"]
            for skill in row["skills"]
            if skill.get("pluginId") == "dopadone@dopadone"
        ]
        assert (
            len(skills) == 1
            and skills[0]["name"] == "dopadone:do"
            and skills[0]["enabled"]
        ), skills

        hooks = [hook for row in results[1]["result"]["data"] for hook in row["hooks"]]
        assert len(hooks) == 1, hooks
        hook = hooks[0]
        assert hook["pluginId"] == "dopadone@dopadone", hook
        assert hook["eventName"] == "userPromptSubmit", hook
        assert hook["handlerType"] == "command" and hook["enabled"], hook
        assert hook["timeoutSec"] == 5 and hook["matcher"] is None, hook
        assert hook["trustStatus"] == "untrusted", hook
        assert hook["command"].startswith('DOPADONE_REMINDERS_ENABLED=false node "'), hook
        assert hook["command"].endswith('/bin/user-prompt.cjs"'), hook

        plugin_root = Path(hook["sourcePath"]).parents[1]
        replay_time_hook(plugin_root, home / "time-hook-state")

        print(
            "PASS: clean native install, one enabled do skill, one untrusted "
            "time-marker-only hook, and direct installed-bundle payload/cadence replay"
        )
