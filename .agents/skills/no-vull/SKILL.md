---
name: no-vull
description: Operate no-vull, the local LLM-powered npm vulnerability scanner with a macOS menu bar app. Use when the user says "connect to no-vull", "set this repo to no-vull", "no-vull this repo", or asks to scan/check/update npm dependencies for vulnerabilities, set up scan-on-pull, or get dependency findings in the menu bar.
---

# no-vull

Local CLI that scans npm projects for vulnerabilities (npm audit + OSV.dev + supply-chain signals), explains findings via a local or cloud LLM, and surfaces results in a macOS menu bar app. Data lives in `~/.no-vull/` (`latest.json`, `target.json`, logs).

## Quick start — "set this repo to no-vull"

When the user says "connect to no-vull" or "set this repo to no-vull", run ONE command from (or pointing at) the repo:

```bash
no-vull target [path]
```

This does everything: registers the repo as the target (`~/.no-vull/target.json`), installs `post-merge` + `post-rewrite` git hooks so every `git pull` triggers a background scan, and kicks off an initial scan. Findings appear in the menu bar automatically. Requires git repo + `package.json` + a lockfile.

Undo with `no-vull target --remove`.

If `no-vull` is not on PATH, run `npm link` from `/Users/davidvargas/Dev/personal/no-vull` first, or use `node /Users/davidvargas/Dev/personal/no-vull/dist/cli.js <command>`.

## Commands

| Command | What it does |
|---------|-------------|
| `no-vull target [path]` | Register target repo: scan on pull + menu bar alerts. `--remove` unsets, `--no-scan` skips initial scan |
| `no-vull [path]` | Full vulnerability scan with LLM analysis. Key flags: `--provider claude\|ollama\|lmstudio\|gemini\|openai\|command`, `--supply-chain`, `--report out.html`, `--webhook <url>`, `--exit-code` |
| `no-vull check [path]` | Fast package-health gate, no LLM. `--fail-on aging\|outdated\|abandoned\|risky`. Exits non-zero on violations (CI) |
| `no-vull update [path]` | Bump flagged packages (npm/pnpm/yarn aware), re-scan to verify. `--dry-run`, `--major` |
| `no-vull init [path]` | Generate `no-vull.config.json` with suggested standards |
| `no-vull watch [path]` | Re-scan on lockfile changes (foreground) |
| `no-vull schedule [path] --every 1h` | Periodic scans via launchd. `--remove` to cancel |
| `no-vull status` | GitHub/Actions upstream status. `--exit-code` for CI |

## Conventions

- Provider/API keys: auto-loaded from `~/.no-vull/.env` (global) and project `.env`. Default provider is Claude (`ANTHROPIC_API_KEY`); `--provider ollama` for fully local.
- Scan results: `~/.no-vull/latest.json` (menu bar watches this), history in `~/.no-vull/scan-log.jsonl`, pull-hook output in `~/.no-vull/hook.log`.
- Read findings programmatically from `latest.json` — fields: `topSeverity`, `totalVulns`, `agentReport.vulnerabilities[]` (package, severity, explanation, remediation), `viralVulns[]`.
- Menu bar app install/update: `MenuBar/install.sh` in the repo (rebuilds + relaunches via launchd).
- Source repo: `/Users/davidvargas/Dev/personal/no-vull`.
