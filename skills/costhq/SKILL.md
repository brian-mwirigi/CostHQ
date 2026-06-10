---
name: costhq
license: MIT-0
description: The Active Circuit Breaker & Cost Tracker for AI SaaS. Enforce hard API budgets, track GPT-4o/Claude costs, and stop runaway agents before they break your unit economics.
metadata: {"openclaw": {"homepage": "https://github.com/brian-mwirigi/costhq", "requires": {"bins": ["cs"]}, "install": [{"id": "npm", "kind": "node", "package": "costhq", "bins": ["cs"], "label": "Install costhq (npm)"}]}}
---

# Session Cost Tracking & Margin Firewall (CostHQ)

The Active Circuit Breaker for AI SaaS. Stop runaway agents before they bankrupt you. CostHQ doesn't just track exact API costs in real-time—we actively enforce them. Set a hard dollar limit per user, per session, or per project. We automatically kill the request before it breaks your unit economics.

**Latest: v4.0.0** - Added Semantic Caching Proxy and Granular Session Termination.

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

- **Always** start a tracked session to set the budget for a risky autonomous task
- **Always** log AI usage after each premium API call (GPT-4o, Claude 3.5 Sonnet)
- **Always** end the session when the task is complete to log the final spend
- Use `cs dashboard` to track your margins and selectively kill expensive background sessions.

## Commands

### Start tracking (Engage Firewall)
```bash
# Agent mode (always use --json for structured output):
cs start "data extraction pipeline" --json --close-stale

# Resume if a session was left open (e.g. after a crash):
cs start "data extraction pipeline" --json --resume
```

### Log AI usage (Track & Enforce)
```bash
# High-cost OpenAI model:
cs log-ai -p openai -m gpt-4o --prompt-tokens 50000 --completion-tokens 15000 -c 1.05 --agent "Extractor" --json

# High-cost Anthropic model:
cs log-ai -p anthropic -m claude-3-5-sonnet-20240620 --prompt-tokens 120000 --completion-tokens 4000 --agent "Summarizer" --json
```

**Agent Name:** Use `--agent "Agent Name"` to track which specific agent logic is burning through your budget.

### Check current margins
```bash
cs status --json
```

### End session
```bash
cs end -n "Pipeline complete, stayed within budget" --json
```
Ending the session automatically logs an audit event (Enterprise) and scans git for files/commits.

### Web Dashboard
```bash
cs dashboard
```
The dashboard shows:
- **Overview** — KPIs, daily trends, cost velocity, and the Semantic Caching Proxy toggle.
- **Command Center** — Real-time CLI execution and granular termination of individual sessions to kill loops manually.
- **Sessions** — searchable/sortable table, per-session details.
- **Compliance** — View the tamper-evident cryptographic SOC2 audit chain and configure Team Identities (Enterprise only).
- **Pro Ops** — Manage licensing, PDF exports, and sync features.

### Semantic Caching Proxy
Stop paying for duplicate queries. CostHQ includes a Semantic Caching Proxy that intercepts API calls and returns cached responses for identical requests for $0.00:
```bash
cs proxy start --port 3739
```
Or toggle it directly from the **Overview** page in the dashboard. Route your tools via `OPENAI_BASE_URL=http://127.0.0.1:3739/openai/v1`.

### View historical stats and details
```bash
cs show --json --files --commits
cs stats --json
cs export --format json --limit 10
```

### Add notes / annotations
```bash
cs note "Hitting OpenAI API now" --json
```

## Agent Workflow

Agents should **always** use `--json` on every command for structured, parseable output.

1. At task start: `cs start "Process user documents" --json --close-stale`
2. Add context notes: `cs note "analyzing document chunks" --json`
3. After each AI call: `cs log-ai -p openai -m gpt-4o --prompt-tokens 80000 --completion-tokens 2000 --agent "DocProcessor" --json`
4. Mid-flight check: `cs status --json` (Verify we haven't hit the budget limit)
5. At task end: `cs end -n "Processed all documents" --json`

## Important
- **Always** use `--json` on every command — agents must use structured output.
- Use `--close-stale` on `cs start` to clear crashed sessions.
- In Enterprise mode, a cryptographic hash chain automatically logs session starts, ends, data resets, and AI usage to guarantee SOC2 compliance.
