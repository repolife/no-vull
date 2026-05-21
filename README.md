# no-vull

Local LLM-powered npm vulnerability and package health analyzer. Runs `npm audit` under the hood, cross-references OSV.dev, scores supply-chain risk, monitors X/Twitter for emerging threats, and routes the results through a local or cloud LLM to produce plain-English explanations and a prioritized action plan — nothing leaves your machine unless you choose a cloud provider.

---

## Features

- **LLM analysis** — every vulnerability explained in plain English with real-world exploitability context, not just CVSS scores
- **Package health scoring** — flags aging, abandoned, outdated, and risky packages against configurable standards
- **OSV.dev cross-check** — matches your lockfile against the Open Source Vulnerabilities database for additional CVEs
- **Supply-chain risk detection** — spots install scripts, maintainer churn, and unusual publish patterns
- **X/Twitter monitoring** — pulls recent security tweets mentioning your vulnerable packages
- **Blast-radius scoring** — shows how many npm packages depend on each vulnerable package (viral impact)
- **Automated updates** — runs the correct package manager command per package, then re-scans to verify
- **HTML report** — self-contained, shareable report file
- **Slack / webhook output** — post results to any HTTP endpoint with Slack Block Kit formatting
- **CI mode** — `check` command exits non-zero on violations, `--exit-code` flag for scan
- **Multi-provider** — Claude, Ollama, LM Studio, Gemini, OpenAI, or any OpenAI-compatible local model
- **pnpm / yarn support** — auto-detects lockfile and package manager

---

## Installation

```bash
# Clone and build
git clone https://github.com/youruser/no-vull
cd no-vull
npm install
npm run build

# Link globally
npm link
```

Or run directly without installing:

```bash
npx tsx src/cli.ts [command] [path]
```

---

## Quick Start

```bash
# Scan the current directory (uses Claude by default)
no-vull

# Scan a specific project
no-vull ~/projects/my-app

# Use a local model via Ollama
no-vull --provider ollama --model llama3.2

# Check health only (no LLM, no lockfile needed)
no-vull check
```

---

## Commands

### `no-vull [path]` — Vulnerability Scan

Runs `npm audit`, cross-references OSV.dev, and sends findings through an LLM for plain-English analysis.

```
no-vull [path] [options]

Options:
  --provider <provider>   LLM provider: claude (default), ollama, lmstudio, gemini, openai
  --model <model>         Model name override (e.g. llama3.2, gemini-2.0-flash, gpt-4o)
  --base-url <url>        Base URL for local providers (Ollama/LM Studio)
  --api-key <key>         API key (falls back to env vars)
  --no-osv                Skip OSV.dev cross-check
  --supply-chain          Check npm registry for supply-chain risks
  --x-token <token>       X/Twitter Bearer token (falls back to X_BEARER_TOKEN)
  --webhook <url>         POST scan result to this URL (Slack or any HTTP endpoint)
  --report <path>         Write a self-contained HTML report (e.g. report.html)
  --exit-code             Exit non-zero if any vulnerabilities found (for CI)
```

**Examples:**

```bash
# Full scan with supply-chain check and HTML report
no-vull --supply-chain --report report.html

# Scan with X/Twitter monitoring
no-vull --x-token $X_BEARER_TOKEN

# Post to Slack
no-vull --webhook https://hooks.slack.com/services/...

# CI: fail if any vulns found
no-vull --exit-code
```

---

### `no-vull init [path]` — Initialize Config

Analyzes your direct dependencies against the npm registry and generates a `no-vull.config.json` with suggested standards tailored to your project.

```
no-vull init [path] [options]

Options:
  --write   Also merge suggested standards into package.json under the "no-vull" key
```

**Example:**

```bash
no-vull init
# → creates no-vull.config.json with suggested maxPackageAgeDays, maxMajorsBehind, etc.
```

Run this once per project. Commit the config file to enforce the same standards across your team.

---

### `no-vull check [path]` — Health Check (CI)

Scores every direct dependency against your `no-vull.config.json` standards. Designed for CI — exits non-zero if any package violates the threshold. No LLM required.

```
no-vull check [path] [options]

Options:
  --fail-on <level>   Minimum risk level that causes a non-zero exit
                      aging | outdated (default) | abandoned | risky
```

**Risk levels (lowest → highest):**

| Level | What it means |
|-------|---------------|
| `healthy` | Passes all standards |
| `aging` | Last publish approaching `maxPackageAgeDays` |
| `outdated` | Behind on major versions or deprecated |
| `abandoned` | No recent publish + low downloads or single maintainer |
| `risky` | Deprecated, disallowed license, or critically low activity |

**Examples:**

```bash
# Fail if any package is outdated or worse
no-vull check

# Fail only on abandoned or risky packages
no-vull check --fail-on abandoned

# Fail on anything aging or worse
no-vull check --fail-on aging
```

**GitHub Actions example:**

```yaml
- name: Package health check
  run: npx no-vull check --fail-on outdated
```

---

### `no-vull update [path]` — Automated Updates

Updates packages flagged by the health check using the correct command for your package manager (npm / pnpm / yarn), then re-scans to verify the risk levels improved.

```
no-vull update [path] [options]

Options:
  --dry-run           Show planned updates without executing anything
  --major             Include major version bumps (skipped by default)
  --fail-on <level>   Which risk levels to target (same as check, default: outdated)
```

**What it does:**

1. Runs a health scan to find packages violating standards
2. Prints the update plan (which command will run, version before/after)
3. Executes each update command in sequence
4. Re-scans and shows which packages improved

**Examples:**

```bash
# Preview what would be updated
no-vull update --dry-run

# Update everything outdated (minor/patch only)
no-vull update

# Include major version bumps
no-vull update --major

# Only target abandoned or risky packages
no-vull update --fail-on abandoned
```

Major version bumps are skipped by default because they may contain breaking changes. They appear in the "skipped" section of the plan — pass `--major` to include them.

---

### `no-vull watch [path]` — Lockfile Watcher

Watches `package-lock.json` (or the detected lockfile) for changes and re-runs a full vulnerability scan automatically. Useful during active development.

```
no-vull watch [path] [options]

Options:
  --provider <provider>   LLM provider (default: claude)
  --model <model>         Model name override
  --no-osv                Skip OSV.dev cross-check
```

**Example:**

```bash
no-vull watch --provider ollama --model llama3.2
```

Debounces rapid lockfile changes during installs (1.5 second delay) to avoid firing mid-write.

---

## LLM Providers

| Provider | Flag | Notes |
|----------|------|-------|
| Claude | `--provider claude` | Default. Requires `ANTHROPIC_API_KEY` |
| Ollama | `--provider ollama` | Local. Default base URL: `http://localhost:11434` |
| LM Studio | `--provider lmstudio` | Local. Default base URL: `http://localhost:1234` |
| Gemini | `--provider gemini` | Requires `GEMINI_API_KEY` |
| OpenAI | `--provider openai` | Requires `OPENAI_API_KEY` |

**Custom base URL** (any OpenAI-compatible endpoint):

```bash
no-vull --provider openai --base-url http://my-server:8080 --model my-model
```

**API key override:**

```bash
no-vull --api-key sk-... --provider openai
```

---

## Configuration

Running `no-vull init` generates `no-vull.config.json` in your project root. You can also create or edit it manually.

```json
{
  "standards": {
    "maxPackageAgeDays": 730,
    "maxMajorsBehind": 2,
    "minWeeklyDownloads": 500,
    "minMaintainers": 1,
    "allowDevDepsToAge": true,
    "allowedLicenses": []
  },
  "ignore": [],
  "exceptions": {}
}
```

### `standards`

| Field | Default | Description |
|-------|---------|-------------|
| `maxPackageAgeDays` | `730` | Days since last publish before a package is flagged aging |
| `maxMajorsBehind` | `2` | Major versions behind latest before flagged outdated |
| `minWeeklyDownloads` | `500` | Weekly download floor below which a package is flagged |
| `minMaintainers` | `1` | Minimum maintainer count |
| `allowDevDepsToAge` | `true` | Skip age checks for `devDependencies` |
| `allowedLicenses` | `[]` | Allowlist of SPDX license identifiers. Empty = allow all |

### `ignore`

Packages to skip entirely in health checks:

```json
{
  "ignore": ["some-internal-package", "legacy-tool"]
}
```

### `exceptions`

Per-package overrides with an optional expiry date:

```json
{
  "exceptions": {
    "old-but-fine": {
      "reason": "Pinned by upstream contract, upgrading Q3",
      "until": "2025-09-01"
    }
  }
}
```

Exceptions suppress health violations for that package. The `until` field is informational — it helps you track when the exception should be revisited.

### License compliance

Set `allowedLicenses` to enforce license policy:

```json
{
  "standards": {
    "allowedLicenses": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"]
  }
}
```

Any package with a license not in the list will be flagged as `risky`.

---

## Environment Variables

| Variable | Used by |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude provider |
| `OPENAI_API_KEY` | OpenAI provider |
| `GEMINI_API_KEY` | Gemini provider |
| `X_BEARER_TOKEN` | X/Twitter monitoring |

---

## Output Formats

### Terminal (default)

Color-coded output with severity indicators, per-vulnerability explanations, and a prioritized action plan.

### HTML Report

```bash
no-vull --report report.html
```

Generates a self-contained HTML file with no external dependencies — safe to attach to emails or open offline.

### Slack / Webhook

```bash
no-vull --webhook https://hooks.slack.com/services/T.../B.../...
```

Posts a Slack Block Kit message with severity color, vulnerability count, and summary. Works with any HTTP endpoint that accepts JSON — the payload uses Slack's attachment format with a fallback plain-text body.

---

## CI Integration

### Fail on any vulnerability

```yaml
- run: no-vull --exit-code
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Fail on outdated packages (no LLM needed)

```yaml
- run: no-vull check --fail-on outdated
```

### Combined

```yaml
- name: Security scan
  run: no-vull --exit-code --no-osv
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Dependency health
  run: no-vull check --fail-on outdated
```

---

## Package Manager Support

no-vull auto-detects your package manager from the lockfile present in the project root:

| Lockfile | Package manager |
|----------|----------------|
| `package-lock.json` | npm |
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn (classic or berry) |

The `update` command uses the correct update command syntax for each package manager automatically.

---

## How It Works

1. **Scan** — runs `npm audit --json` (or reads existing lockfile) to get raw vulnerability data
2. **Enrich** — queries OSV.dev, npm registry, and optionally supply-chain signals and X/Twitter
3. **Score** — calculates blast radius (dependent package count) for each vulnerable package
4. **Analyze** — sends everything to the LLM with a security-expert system prompt, receives structured JSON
5. **Report** — renders colored terminal output, and optionally HTML or webhook payload
6. **Store** — persists scan results to `.no-vull/` for diff-based comparison in future scans

---

## Local Development

```bash
npm install
npm run dev -- [command] [path]   # runs via tsx, no build step needed
npm run build                      # compiles to dist/
```
