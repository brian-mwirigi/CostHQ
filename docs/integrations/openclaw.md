# OpenClaw + codesession-cli  —  1-minute setup

## Install (3 commands)

```bash
npm install -g codesession-cli   # CLI
clawhub install codesession      # Skill
cs --version                     # Should print 2.0.0
```

Start a new OpenClaw session. Done — the agent tracks costs automatically.

## Example Transcript

```
You: Fix the payment retry logic and add tests

Agent:
  $ cs start "Fix payment retry + tests" --close-stale --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","id":12,"name":"Fix payment retry + tests","directory":"/home/user/project","gitRoot":"/home/user/project","branch":"main"}

  $ cs note "analyzing existing retry implementation" --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","id":1,"sessionId":12,"message":"analyzing existing retry implementation","timestamp":"2026-02-09T14:30:05.000Z"}

  [reads src/payments.ts, src/retry.ts, identifies the bug]

  $ cs log-ai -p anthropic -m claude-sonnet-4 --prompt-tokens 8000 --completion-tokens 2000 --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","logged":{"provider":"anthropic","model":"claude-sonnet-4","tokens":10000,"promptTokens":8000,"completionTokens":2000,"cost":0.054},"pricing":{"source":"built-in","modelKnown":true,"inputPer1M":3,"outputPer1M":15},"session":{"id":12,"aiCost":0.054,"aiTokens":10000}}

  [edits src/retry.ts — adds exponential backoff, writes tests]

  $ cs log-ai -p anthropic -m claude-sonnet-4 --prompt-tokens 12000 --completion-tokens 4000 --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","logged":{"provider":"anthropic","model":"claude-sonnet-4","tokens":16000,"promptTokens":12000,"completionTokens":4000,"cost":0.096},"pricing":{"source":"built-in","modelKnown":true,"inputPer1M":3,"outputPer1M":15},"session":{"id":12,"aiCost":0.15,"aiTokens":26000}}

  $ cs note "tests passing, committing" --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","id":2,"sessionId":12,"message":"tests passing, committing","timestamp":"2026-02-09T14:38:22.000Z"}

  $ cs end -n "Fixed retry logic, added exponential backoff + 3 tests" --json
  {"schemaVersion":1,"codesessionVersion":"2.0.0","id":12,"name":"Fix payment retry + tests","status":"completed","startTime":"2026-02-09T14:30:00.000Z","endTime":"2026-02-09T14:39:01.000Z","duration":541,"durationFormatted":"9m","workingDirectory":"/home/user/project","gitRoot":"/home/user/project","filesChanged":3,"commits":[{"hash":"a1b2c3d","message":"fix: exponential backoff retry"}],"aiTokens":26000,"aiCost":0.15,"annotations":[{"message":"analyzing existing retry implementation"},{"message":"tests passing, committing"}]}

  Done — 9 minutes, 3 files, 1 commit, $0.15 total.
```

## Key Flags for Agents

| Flag | Why |
|------|-----|
| `--json` | Machine-readable output on every command |
| `--close-stale` | Prevents `session_active` errors from prior crashes |
| `--prompt-tokens` / `--completion-tokens` | Auto-calculates cost from built-in pricing table |
| `-s <id>` | Targets a specific session (multi-repo safety) |

## Error Handling

Errors exit `1` and return structured JSON:

```json
{"schemaVersion":1,"error":{"code":"no_active_session","message":"No active session"}}
```

Parse `error.code` — never string-compare `error.message`.

## Failsafe

If `cs` isn't installed, the agent should skip tracking and continue with the primary task:

```bash
which cs >/dev/null 2>&1 || { echo "codesession not installed, skipping tracking"; }
```

On Windows: `where cs` instead of `which cs`.
