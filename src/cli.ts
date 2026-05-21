#!/usr/bin/env node
import { config as loadEnv } from "./env.js";
loadEnv();
import { program } from "commander";
import { resolve } from "path";
import chalk from "chalk";
import { runAudit, summarizeReport, detectPackageManager, detectLockfile } from "./scanner.js";
import { checkOsv, formatOsvFindings } from "./osv.js";
import { checkSupplyChain, formatSupplyChainRisks } from "./supply-chain.js";
import { checkXAlerts, formatXAlerts } from "./x-monitor.js";
import { writeScanResult } from "./storage.js";
import { postWebhook } from "./webhook.js";
import { generateHtmlReport } from "./report-html.js";
import { fetchDependentCounts } from "./viral.js";
import { loadConfig, writeConfig, CONFIG_FILENAME } from "./config.js";
import { analyzeHealth } from "./health.js";
import { analyzeVulnerabilities, type Provider } from "./agent.js";
import {
  printHeader,
  printScanStart,
  printScanResult,
  printOsvFindings,
  printSupplyChainRisks,
  printXAlerts,
  printStreamChunk,
  printReport,
  printNoVulns,
  printError,
  printHealthReport,
  printHealthProgress,
  printConfigSuggestion,
  printCheckReport,
  printUpdatePlan,
  printUpdateResult,
  type UpdateAction,
} from "./reporter.js";

// ─── init ────────────────────────────────────────────────────────────────────
program
  .command("init [path]")
  .description("Analyze package health and generate no-vull.config.json with suggested standards")
  .option("--write", "Merge suggested standards into package.json as well")
  .action(async (targetPath = ".", opts: { write?: boolean }) => {
    const repoPath = resolve(targetPath);
    const configPath = resolve(repoPath, CONFIG_FILENAME);
    const { existsSync, readFileSync, writeFileSync } = await import("fs");
    const isNew = !existsSync(configPath);

    printHeader(repoPath);
    console.log(chalk.dim("  Analyzing direct dependencies against npm registry...\n"));

    const config = loadConfig(repoPath);
    let healthReport;
    try {
      healthReport = await analyzeHealth(repoPath, config, (done, total) =>
        printHealthProgress(done, total)
      );
    } catch (err) {
      printError(err);
      process.exit(1);
    }

    const suggested = {
      ...config,
      standards: { ...config.standards, ...healthReport.suggestedStandards },
    };

    if (isNew) writeConfig(repoPath, suggested);

    // --write: merge into package.json
    if (opts.write) {
      const pkgPath = resolve(repoPath, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
        pkg["no-vull"] = suggested.standards;
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        console.log(chalk.green(`  Wrote standards to package.json\n`));
      }
    }

    printHealthReport(healthReport, configPath, isNew);
    printConfigSuggestion(configPath, loadConfig(repoPath));
  });

// ─── check ───────────────────────────────────────────────────────────────────
program
  .command("check [path]")
  .description(
    "Non-interactive health check — exits non-zero if any package violates standards (for CI)"
  )
  .option("--fail-on <level>", "Minimum risk level that fails the check: aging|outdated|abandoned|risky", "outdated")
  .action(async (targetPath = ".", opts: { failOn: string }) => {
    const repoPath = resolve(targetPath);
    printHeader(repoPath);
    console.log(chalk.dim("  Running health check...\n"));

    const config = loadConfig(repoPath);
    let healthReport;
    try {
      healthReport = await analyzeHealth(repoPath, config, (done, total) =>
        printHealthProgress(done, total)
      );
    } catch (err) {
      printError(err);
      process.exit(1);
    }

    const failLevels: Record<string, string[]> = {
      aging:     ["aging", "outdated", "abandoned", "risky"],
      outdated:  ["outdated", "abandoned", "risky"],
      abandoned: ["abandoned", "risky"],
      risky:     ["risky"],
    };
    const failing = failLevels[opts.failOn] ?? ["outdated", "abandoned", "risky"];
    const violations = healthReport.packages.filter((p) => failing.includes(p.riskLevel));

    printCheckReport(healthReport, violations, opts.failOn);

    if (violations.length > 0) process.exit(1);
  });

// ─── watch ───────────────────────────────────────────────────────────────────
program
  .command("watch [path]")
  .description("Watch package-lock.json for changes and re-scan automatically")
  .option("--provider <provider>", "LLM provider (env: NO_VULL_PROVIDER)")
  .option("--model <model>", "Model name override (env: NO_VULL_MODEL)")
  .option("--no-osv", "Skip OSV.dev cross-check")
  .action(async (targetPath = ".", opts: { provider?: string; model?: string; osv: boolean }) => {
    const effectiveProvider = opts.provider ?? process.env.NO_VULL_PROVIDER ?? "claude";
    const effectiveModel = opts.model ?? process.env.NO_VULL_MODEL;
    const { watch, existsSync } = await import("fs");
    const repoPath = resolve(targetPath);
    const lockPath = detectLockfile(repoPath);

    if (!existsSync(lockPath)) {
      printError("No lockfile found (package-lock.json, pnpm-lock.yaml, yarn.lock) — watch requires a lockfile");
      process.exit(1);
    }

    const pm = detectPackageManager(repoPath);
    console.log(chalk.bold("\n no-vull watch\n"));
    console.log(chalk.dim(`  Package manager: ${pm}`));
    console.log(chalk.dim(`  Watching ${lockPath}\n`));
    console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

    async function runScan() {
      printHeader(repoPath, effectiveProvider);
      printScanStart(pm);
      try {
        const report = runAudit(repoPath);
        const summary = summarizeReport(report);
        printScanResult(summary);
        const vulnCount = Object.keys(report.vulnerabilities).length;
        if (vulnCount === 0) {
          printNoVulns();
          writeScanResult(repoPath, null, [], [], []);
          return;
        }
        const osvFindings = opts.osv ? await checkOsv(repoPath).catch(() => []) : [];
        const agentReport = await analyzeVulnerabilities(
          report, osvFindings, printStreamChunk,
          { provider: effectiveProvider as Provider, model: effectiveModel }
        );
        printReport(agentReport);
        writeScanResult(repoPath, agentReport, osvFindings, [], []);
      } catch (err) {
        printError(err);
      }
    }

    // Initial scan on start
    await runScan();

    // Debounced watcher — lockfile changes fire rapidly during installs
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watch(lockPath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        console.log(chalk.dim("\n  package-lock.json changed — re-scanning...\n"));
        await runScan();
      }, 1500);
    });
  });

// ─── update ──────────────────────────────────────────────────────────────────
program
  .command("update [path]")
  .description("Update packages flagged by health check, then re-scan to verify")
  .option("--dry-run", "Show planned updates without executing")
  .option("--major", "Include major version bumps (default: minor/patch only)")
  .option("--fail-on <level>", "Risk levels to target", "outdated")
  .action(async (targetPath = ".", opts: { dryRun?: boolean; major?: boolean; failOn: string }) => {
    const repoPath = resolve(targetPath);
    printHeader(repoPath);
    console.log(chalk.dim("  Scanning for packages to update...\n"));

    const config = loadConfig(repoPath);
    const pm = detectPackageManager(repoPath);

    let healthReport;
    try {
      healthReport = await analyzeHealth(repoPath, config, (done, total) =>
        printHealthProgress(done, total)
      );
    } catch (err) {
      printError(err);
      process.exit(1);
    }

    const failLevels: Record<string, string[]> = {
      aging:     ["aging", "outdated", "abandoned", "risky"],
      outdated:  ["outdated", "abandoned", "risky"],
      abandoned: ["abandoned", "risky"],
      risky:     ["risky"],
    };
    const failing = failLevels[opts.failOn] ?? ["outdated", "abandoned", "risky"];
    const violations = healthReport.packages.filter((p) => failing.includes(p.riskLevel));

    if (violations.length === 0) {
      console.log(chalk.green("  Nothing to update — all packages within standards.\n"));
      return;
    }

    const actions: UpdateAction[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const pkg of violations) {
      const isMajorBump = pkg.majorsBehind > 0;
      if (isMajorBump && !opts.major) {
        skipped.push({
          name: pkg.name,
          reason: `${pkg.majorsBehind} major version(s) behind — pass --major to bump`,
        });
        continue;
      }
      let command: string;
      if (pm === "pnpm") {
        command = isMajorBump
          ? `pnpm update ${pkg.name} --latest`
          : `pnpm update ${pkg.name}`;
      } else if (pm === "yarn") {
        command = isMajorBump
          ? `yarn upgrade ${pkg.name} --latest`
          : `yarn upgrade ${pkg.name}`;
      } else {
        command = isMajorBump
          ? `npm install ${pkg.name}@latest`
          : `npm update ${pkg.name}`;
      }
      actions.push({
        name: pkg.name,
        from: pkg.installedVersion,
        to: pkg.latestVersion,
        riskLevel: pkg.riskLevel,
        isMajorBump,
        command,
      });
    }

    printUpdatePlan(actions, skipped);

    if (opts.dryRun) {
      console.log(chalk.dim("  Dry run — no changes made.\n"));
      return;
    }

    const { execFileSync } = await import("child_process");
    for (const action of actions) {
      const parts = action.command.split(" ");
      try {
        execFileSync(parts[0], parts.slice(1), { cwd: repoPath, stdio: "inherit" });
      } catch (err) {
        printError(`Failed to run: ${action.command}\n  ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let afterReport;
    try {
      afterReport = await analyzeHealth(repoPath, config, (done, total) =>
        printHealthProgress(done, total)
      );
    } catch (err) {
      printError(err);
      process.exit(1);
    }

    const updatedNames = new Set(actions.map((a) => a.name));
    printUpdateResult(
      violations.filter((v) => updatedNames.has(v.name)),
      afterReport.packages.filter((p) => updatedNames.has(p.name))
    );
  });

// ─── scan (default) ───────────────────────────────────────────────────────────
program
  .name("no-vull")
  .description("Local LLM-powered npm vulnerability analyzer")
  .version("0.1.0")
  .argument("[path]", "Path to npm project (default: current directory)", ".")
  .option("--provider <provider>", "LLM provider: claude (default), ollama, lmstudio, gemini, openai (env: NO_VULL_PROVIDER)")
  .option("--model <model>", "Model name override, e.g. llama3.2, gemini-2.0-flash, gpt-4o (env: NO_VULL_MODEL)")
  .option("--base-url <url>", "Base URL for local providers")
  .option("--api-key <key>", "API key (falls back to env vars)")
  .option("--no-osv", "Skip OSV.dev cross-check")
  .option("--supply-chain", "Check npm registry for supply-chain risks")
  .option("--x-token <token>", "X/Twitter Bearer token (falls back to X_BEARER_TOKEN env var)")
  .option("--webhook <url>", "Post scan result to this URL (Slack incoming webhook or any HTTP endpoint)")
  .option("--report <path>", "Write a self-contained HTML report to this file (e.g. report.html)")
  .option("--exit-code", "Exit non-zero if any vulnerabilities found (for CI)")
  .action(
    async (
      targetPath: string,
      opts: {
        provider: string;
        model?: string;
        baseUrl?: string;
        apiKey?: string;
        osv: boolean;
        supplyChain: boolean;
        xToken?: string;
        webhook?: string;
        report?: string;
        exitCode: boolean;
      }
    ) => {
      const repoPath = resolve(targetPath);
      const provider = (opts.provider ?? process.env.NO_VULL_PROVIDER ?? "claude") as Provider;
      const model = opts.model ?? process.env.NO_VULL_MODEL;
      const xBearerToken = opts.xToken ?? process.env.X_BEARER_TOKEN;

      const pm = detectPackageManager(repoPath);
      printHeader(repoPath, provider);
      printScanStart(pm);

      const auditPromise = Promise.resolve().then(() => runAudit(repoPath));
      const osvPromise    = opts.osv         ? checkOsv(repoPath).catch(() => [])              : Promise.resolve([]);
      const scPromise     = opts.supplyChain  ? checkSupplyChain(repoPath).catch(() => [])      : Promise.resolve([]);
      const xPromise      = xBearerToken      ? checkXAlerts(repoPath, xBearerToken).catch(() => []) : Promise.resolve([]);

      let report;
      try {
        report = await auditPromise;
      } catch (err) {
        printError(err);
        process.exit(1);
      }

      const vulnPackageNames = Object.keys(report.vulnerabilities);
      const dependentCountsPromise = vulnPackageNames.length > 0
        ? fetchDependentCounts(vulnPackageNames).catch(() => new Map())
        : Promise.resolve(new Map<string, number>());

      const [osvFindings, supplyChainRisks, xAlerts, dependentCounts] = await Promise.all([
        osvPromise, scPromise, xPromise, dependentCountsPromise,
      ]);

      printScanResult(summarizeReport(report));
      if (osvFindings.length > 0)      printOsvFindings(formatOsvFindings(osvFindings));
      if (supplyChainRisks.length > 0) printSupplyChainRisks(formatSupplyChainRisks(supplyChainRisks));
      if (xAlerts.length > 0)          printXAlerts(formatXAlerts(xAlerts));

      const vulnCount  = Object.keys(report.vulnerabilities).length;
      const hasFindings = vulnCount > 0 || osvFindings.length > 0;

      if (!hasFindings && supplyChainRisks.length === 0 && xAlerts.length === 0) {
        printNoVulns();
        const cleanRecord = writeScanResult(repoPath, null, [], [], []);
        if (opts.webhook) {
          await postWebhook(opts.webhook, cleanRecord).catch((err: unknown) => {
            printError(`Webhook failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
        if (opts.report) {
          const { writeFileSync } = await import("fs");
          writeFileSync(opts.report, generateHtmlReport(cleanRecord), "utf-8");
          console.log(chalk.dim(`  Report written to ${opts.report}\n`));
        }
        return;
      }

      if (!hasFindings) return;

      let agentReport;
      try {
        agentReport = await analyzeVulnerabilities(report, osvFindings, printStreamChunk, {
          provider, model, baseUrl: opts.baseUrl, apiKey: opts.apiKey,
        }, dependentCounts);
      } catch (err) {
        printError(err);
        process.exit(1);
      }

      printReport(agentReport);
      const record = writeScanResult(repoPath, agentReport, osvFindings, supplyChainRisks, xAlerts, dependentCounts);

      if (opts.webhook) {
        await postWebhook(opts.webhook, record).catch((err: unknown) => {
          printError(`Webhook failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      if (opts.report) {
        const { writeFileSync } = await import("fs");
        writeFileSync(opts.report, generateHtmlReport(record), "utf-8");
        console.log(chalk.dim(`  Report written to ${opts.report}\n`));
      }

      if (opts.exitCode && agentReport.totalVulnerabilities > 0) process.exit(1);
    }
  );

program.parse();
