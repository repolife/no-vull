import chalk from "chalk";
import type { AgentReport, VulnerabilityAnalysis } from "./agent.js";
import type { HealthReport, RiskLevel, PackageHealth } from "./health.js";
import type { NoVullConfig } from "./config.js";

const severityColor = {
  critical: chalk.red.bold,
  high: chalk.red,
  moderate: chalk.yellow,
  low: chalk.cyan,
  info: chalk.gray,
};

function colorBySeverity(severity: string, text: string): string {
  const fn = severityColor[severity.toLowerCase() as keyof typeof severityColor] ?? chalk.white;
  return fn(text);
}

const exploitabilityLabel = {
  high: chalk.red("HIGH"),
  medium: chalk.yellow("MEDIUM"),
  low: chalk.green("LOW"),
};

export function printHeader(repoPath: string, provider?: string): void {
  console.log(chalk.bold("\n no-vull — npm vulnerability analyzer\n"));
  console.log(chalk.dim(`  Target:   ${repoPath}`));
  if (provider) {
    console.log(chalk.dim(`  Provider: ${provider}`));
  }
  console.log(chalk.dim(`  ${"─".repeat(50)}\n`));
}

export function printScanStart(pm = "npm"): void {
  console.log(chalk.dim(`  Running ${pm} audit...`));
}

export function printScanResult(summary: string): void {
  console.log(`\n${summary}\n`);
  console.log(chalk.dim("  Sending to Claude for analysis...\n"));
  console.log(chalk.dim("  " + "─".repeat(50)));
  console.log();
}

export function printOsvFindings(text: string): void {
  console.log(chalk.yellow(text));
}

export function printSupplyChainRisks(text: string): void {
  console.log(chalk.red(text));
}

export function printXAlerts(text: string): void {
  console.log(chalk.magenta(text));
}

export function printStreamChunk(text: string): void {
  process.stdout.write(text);
}

export function printReport(report: AgentReport): void {
  console.log("\n\n" + chalk.dim("  " + "─".repeat(50)));
  console.log(chalk.bold("\n  SUMMARY\n"));
  console.log(`  ${report.summary}\n`);

  if (report.actionPlan.length > 0) {
    console.log(chalk.bold("  ACTION PLAN\n"));
    report.actionPlan.forEach((action, i) => {
      console.log(`  ${chalk.bold(String(i + 1) + ".")} ${action}`);
    });
    console.log();
  }

  if (report.vulnerabilities.length > 0) {
    console.log(chalk.bold("  VULNERABILITIES\n"));
    report.vulnerabilities.forEach((vuln: VulnerabilityAnalysis) => {
      const severityTag = colorBySeverity(vuln.severity, `[${vuln.severity.toUpperCase()}]`);
      const exploitTag = exploitabilityLabel[vuln.exploitability] ?? vuln.exploitability;

      console.log(`  ${severityTag} ${chalk.bold(vuln.package)} — exploitability: ${exploitTag}`);
      console.log(`  ${vuln.explanation}`);
      console.log(`  ${chalk.italic("Fix:")} ${vuln.remediation}`);
      if (vuln.command) {
        console.log(`  ${chalk.green("$")} ${chalk.cyan(vuln.command)}`);
      }
      console.log();
    });
  }
}

export function printNoVulns(): void {
  console.log(chalk.green.bold("  No vulnerabilities found. All clear.\n"));
}

export function printError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`\n  Error: ${msg}\n`));
}

// ─── Health / init report ────────────────────────────────────────────────────

type ChalkFn = (text: string) => string;
const riskColor: Record<RiskLevel, ChalkFn> = {
  abandoned: chalk.red.bold,
  risky:     chalk.red,
  outdated:  chalk.yellow,
  aging:     chalk.dim.yellow,
  healthy:   chalk.green,
};

const riskIcon: Record<RiskLevel, string> = {
  abandoned: "✖",
  risky:     "!",
  outdated:  "↑",
  aging:     "~",
  healthy:   "✓",
};

export function printHealthReport(report: HealthReport, configPath: string, isNew: boolean): void {
  const byRisk = (level: RiskLevel) => report.packages.filter((p) => p.riskLevel === level);
  const abandoned = byRisk("abandoned");
  const risky     = byRisk("risky");
  const outdated  = byRisk("outdated");
  const aging     = byRisk("aging");
  const healthy   = byRisk("healthy");

  console.log(chalk.bold("\n  PACKAGE HEALTH SNAPSHOT\n"));
  console.log(`  ${report.totalDirect} direct dependencies checked\n`);

  const groups: Array<[RiskLevel, typeof abandoned]> = [
    ["abandoned", abandoned],
    ["risky",     risky],
    ["outdated",  outdated],
    ["aging",     aging],
    ["healthy",   healthy],
  ];

  for (const [level, pkgs] of groups) {
    if (pkgs.length === 0) continue;
    const color = riskColor[level];
    const icon  = riskIcon[level];
    console.log(color(`  ${icon} ${level.toUpperCase()} (${pkgs.length})`));
    for (const pkg of pkgs) {
      const installed   = pkg.installedVersion;
      const latest      = pkg.latestVersion !== installed ? chalk.dim(` → ${pkg.latestVersion}`) : "";
      const devTag      = pkg.isDev ? chalk.dim(" [dev]") : "";
      const licenseTag  = pkg.license && pkg.license !== "unknown" ? chalk.dim(` [${pkg.license}]`) : "";
      console.log(`      ${chalk.bold(pkg.name)}@${installed}${latest}${devTag}${licenseTag}`);
      for (const reason of pkg.riskReasons) {
        console.log(chalk.dim(`        ${reason}`));
      }
    }
    console.log();
  }

  console.log(chalk.dim("  " + "─".repeat(50)));

  if (isNew) {
    console.log(chalk.bold("\n  SUGGESTED STANDARDS  ") + chalk.dim(`(written to ${configPath})\n`));
  } else {
    console.log(chalk.bold("\n  ACTIVE STANDARDS\n"));
  }

  const s = report.suggestedStandards;
  console.log(`  Max package age:         ${chalk.cyan(String(s.maxPackageAgeDays))} days`);
  console.log(`  Max major versions behind: ${chalk.cyan(String(s.maxMajorsBehind))}`);
  console.log(`  Min weekly downloads:    ${chalk.cyan(s.minWeeklyDownloads.toLocaleString())}`);
  console.log(`  Min maintainers:         ${chalk.cyan(String(s.minMaintainers))}`);
  if (s.allowedLicenses && s.allowedLicenses.length > 0) {
    console.log(`  Allowed licenses:        ${chalk.cyan(s.allowedLicenses.join(", "))}`);
  } else {
    console.log(`  Allowed licenses:        ${chalk.dim("(none configured — all licenses permitted)")}`);
  }
  console.log();

  if (isNew) {
    console.log(chalk.dim("  Edit no-vull.config.json to adjust these thresholds."));
    console.log(chalk.dim("  Run `no-vull <path>` to scan for CVEs against these standards.\n"));
  }
}

export function printHealthProgress(done: number, total: number): void {
  process.stdout.write(`\r  Checking npm registry... ${done}/${total}`);
  if (done === total) process.stdout.write("\n");
}

export function printCheckReport(
  report: HealthReport,
  violations: HealthReport["packages"],
  failOn: string
): void {
  const total = report.packages.length;
  if (violations.length === 0) {
    console.log(chalk.green.bold(`\n  PASS — all ${total} packages meet standards (--fail-on ${failOn})\n`));
    return;
  }

  console.log(chalk.red.bold(`\n  FAIL — ${violations.length}/${total} packages violate standards\n`));
  for (const pkg of violations) {
    const color      = riskColor[pkg.riskLevel];
    const licenseTag = pkg.license && pkg.license !== "unknown" ? chalk.dim(` [${pkg.license}]`) : "";
    console.log(color(`  [${pkg.riskLevel.toUpperCase()}] ${pkg.name}@${pkg.installedVersion}${licenseTag}`));
    for (const reason of pkg.riskReasons) {
      console.log(chalk.dim(`         ${reason}`));
    }
  }
  console.log();
  console.log(chalk.dim(`  Run \`no-vull init\` to review and update standards, or add exceptions to no-vull.config.json.\n`));
}

export interface UpdateAction {
  name: string;
  from: string;
  to: string;
  riskLevel: RiskLevel;
  isMajorBump: boolean;
  command: string;
}

export function printUpdatePlan(
  actions: UpdateAction[],
  skipped: Array<{ name: string; reason: string }>
): void {
  console.log(chalk.bold("\n  UPDATE PLAN\n"));

  if (actions.length === 0 && skipped.length === 0) {
    console.log(chalk.green("  Nothing to update.\n"));
    return;
  }

  if (actions.length > 0) {
    console.log(chalk.bold("  Will update:\n"));
    for (const a of actions) {
      const color = riskColor[a.riskLevel];
      const bump = a.isMajorBump ? chalk.yellow(" [MAJOR]") : "";
      console.log(`  ${color(`[${a.riskLevel.toUpperCase()}]`)} ${chalk.bold(a.name)}  ${chalk.dim(a.from)} → ${chalk.cyan(a.to)}${bump}`);
      console.log(chalk.dim(`         $ ${a.command}`));
    }
    console.log();
  }

  if (skipped.length > 0) {
    console.log(chalk.dim("  Skipped (pass --major to include major bumps):\n"));
    for (const s of skipped) {
      console.log(chalk.dim(`    ${s.name} — ${s.reason}`));
    }
    console.log();
  }
}

export function printUpdateResult(
  before: PackageHealth[],
  after: PackageHealth[]
): void {
  const afterMap = new Map(after.map((p) => [p.name, p]));
  const improved: Array<{ name: string; was: RiskLevel; now: RiskLevel }> = [];
  const unchanged: Array<{ name: string; level: RiskLevel }> = [];

  for (const pkg of before) {
    const updated = afterMap.get(pkg.name);
    if (!updated) continue;
    if (updated.riskLevel !== pkg.riskLevel) {
      improved.push({ name: pkg.name, was: pkg.riskLevel, now: updated.riskLevel });
    } else {
      unchanged.push({ name: pkg.name, level: pkg.riskLevel });
    }
  }

  console.log(chalk.bold("\n  UPDATE RESULT\n"));

  if (improved.length > 0) {
    console.log(chalk.green.bold(`  ✓ ${improved.length} package${improved.length === 1 ? "" : "s"} improved:\n`));
    for (const p of improved) {
      console.log(`    ${chalk.bold(p.name)}  ${riskColor[p.was](p.was)} → ${riskColor[p.now](p.now)}`);
    }
    console.log();
  }

  if (unchanged.length > 0) {
    console.log(chalk.yellow(`  ~ ${unchanged.length} package${unchanged.length === 1 ? "" : "s"} still failing:\n`));
    for (const p of unchanged) {
      console.log(`    ${riskColor[p.level](`[${p.level.toUpperCase()}]`)} ${p.name}`);
    }
    console.log();
  }

  if (improved.length > 0 && unchanged.length === 0) {
    console.log(chalk.green.bold("  All violations resolved.\n"));
  }
}

export function printConfigSuggestion(configPath: string, config: NoVullConfig): void {
  console.log(chalk.bold("\n  SUGGESTED package.json ADDITIONS\n"));
  console.log(chalk.dim("  Add this to your package.json to document your standards:\n"));
  const snippet = {
    "no-vull": config.standards,
  };
  console.log(
    "  " +
    JSON.stringify(snippet, null, 2)
      .split("\n")
      .join("\n  ")
  );
  console.log();
}
