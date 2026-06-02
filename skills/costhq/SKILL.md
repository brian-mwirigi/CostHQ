---
name: costhq
license: MIT-0
description: Track agent session costs, file changes, and git commits with CostHQ. Enforces budget limits, tracks local models, and provides Enterprise SOC2 audit trails via a web dashboard. v3.3.0 - Enterprise SOC2 Audit Logging and Local Models.
metadata: {"openclaw": {"homepage": "https://github.com/brian-mwirigi/costhq", "requires": {"bins": ["cs"]}, "install": [{"id": "npm", "kind": "node", "package": "costhq", "bins": ["cs"], "label": "Install costhq (npm)"}]}}
---

# Session Cost Tracking (CostHQ)

Track agent session costs, file changes, and git commits. Enforces budget limits, tracks local models (Ollama, vLLM), and provides detailed session analytics with a full web dashboard and tamper-evident SOC2 audit logging for Enterprise users.

**Latest: v3.3.0** - Added Enterprise SOC2 Audit Trails and Local Models (compute-time costing).

📦 [npm](https://www.npmjs.com/package/costhq) • ⭐ [GitHub](https://github.com/brian-mwirigi/costhq) • 📝 [Changelog](https://github.com/brian-mwirigi/costhq/blob/main/CHANGELOG.md)

## Installation

```bash
# 1. Install the CLI globally from npm
npm install -g costhq

# 2. Install the OpenClaw skill
clawhub install costhq
```

After installing, the `cs` command is available globally. The OpenClaw agent will automatically use it to track sessions.

> **Requirements:** Node.js 18+ and C/C++ build tools (needed to compile the embedded SQLite module).
>
> | OS | Install build tools |
> |---|---|
> | **Ubuntu/Debian** | `sudo apt-get install -y build-essential python3` |
> | **macOS** | `xcode-select --install` |
> | **Windows** | `npm install -g windows-build-tools` or install Visual Studio Build Tools |
> | **Alpine** | `apk add build-base python3` |
>
> Data is stored locally at `~/.costhq/sessions.db` (or `~/.CostHQ`).

## When to use

- **Always** start a tracked session at the beginning of a multi-step task
- **Always** log AI usage after each API call you make
- **Always** end the session when the task is complete
- Use `cs dashboard` to review session data, set up local models, or verify the audit trail (Enterprise).

## Commands

### Start tracking
```bash
# Agent mode (always use --json for structured output):
cs start "task description" --json --close-stale

# Resume if a session was left open (e.g. after a crash):
cs start "task description" --json --resume
```

### Log AI usage (after each API call)
```bash
# Standard cloud model (cost auto-calculated):
cs log-ai -p anthropic -m claude-sonnet-4 --prompt-tokens 8000 --completion-tokens 2000 --json

# Local model with compute duration (NEW in v3.3.0):
# Use --duration in seconds (120) or string (2m30s). Cost is based on registered $/hr rate.
cs log-ai -p ollama -m llama3 --tokens 4500 --duration 2m30s --local --json

# With all fields:
cs log-ai -p openai -m gpt-4o --prompt-tokens 5000 --completion-tokens 1500 -c 0.04 --agent "Research Agent" --json
```

**Agent Name:** Use `--agent "Agent Name"` to track which agent performed the work.
**Local Models:** You can track self-hosted models (Ollama, llama.cpp, vLLM) by registering a GPU hourly rate in the dashboard. Use `--duration` and `--local` when logging.

### Check current status
```bash
cs status --json
```

### End session and get summary
```bash
cs end -n "completion notes" --json
```
Ending the session automatically logs an audit event (Enterprise) and scans git for files/commits.

### Web Dashboard
```bash
cs dashboard
```
The dashboard shows:
- **Overview** — KPIs, daily trends, cost velocity.
- **Sessions** — searchable/sortable table, per-session details.
- **Local Models** — Register compute rates ($/hr) for Ollama, vLLM, etc.
- **Compliance** — View the tamper-evident cryptographic SOC2 audit chain and configure Team Identities (Enterprise only).
- **Pro Ops** — Manage licensing, PDF exports, and sync features.

### View historical stats and details
```bash
cs show --json --files --commits
cs stats --json
cs export --format json --limit 10
```

### Add notes / annotations
```bash
cs note "Tests passing, moving to cleanup" --json
```

## Agent Workflow

Agents should **always** use `--json` on every command for structured, parseable output.

1. At task start: `cs start "Fix authentication bug" --json --close-stale`
2. Add context notes: `cs note "analyzing auth flow" --json`
3. After each AI call: `cs log-ai -p anthropic -m claude-sonnet-4 --prompt-tokens 800 --completion-tokens 200 --agent "Bug Fixer" --json`
4. If using a local model: `cs log-ai -p ollama -m mistral --tokens 1000 --duration 45s --local --json`
5. At task end: `cs end -n "Fixed the auth bug" --json`

## Budget & Pricing
- Standard pricing is configurable via `cs pricing set my-model 5.00 15.00`.
- Local model pricing (compute-based) is configured in the `cs dashboard` under **Local Models**.
- Check `cs status --json` before expensive operations.

## Important
- **Always** use `--json` on every command — agents must use structured output.
- Use `--close-stale` on `cs start` to clear crashed sessions.
- In Enterprise mode, a cryptographic hash chain automatically logs session starts, ends, data resets, and AI usage.
