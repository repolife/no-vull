import { execSync, execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type PackageManager = "npm" | "pnpm" | "yarn";

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}

export function detectLockfile(repoPath: string): string {
  const pm = detectPackageManager(repoPath);
  if (pm === "pnpm") return join(repoPath, "pnpm-lock.yaml");
  if (pm === "yarn") return join(repoPath, "yarn.lock");
  return join(repoPath, "package-lock.json");
}

function isYarnClassic(repoPath: string): boolean {
  try {
    const first = readFileSync(join(repoPath, "yarn.lock"), "utf-8").slice(0, 300);
    return first.includes("# yarn lockfile v1");
  } catch {
    return true;
  }
}

function parseYarnClassicAudit(output: string): AuditReport {
  const vulnerabilities: Record<string, AuditVulnerability> = {};
  const meta = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        type: string;
        data: {
          advisory?: {
            module_name: string;
            severity: string;
            title: string;
            vulnerable_versions: string;
            patched_versions: string;
            findings: Array<{ paths: string[] }>;
          };
          vulnerabilities?: typeof meta;
        };
      };
      if (obj.type === "auditAdvisory" && obj.data.advisory) {
        const a = obj.data.advisory;
        const severity = a.severity as AuditVulnerability["severity"];
        vulnerabilities[a.module_name] = {
          name: a.module_name,
          severity,
          via: [a.title],
          effects: [],
          range: a.vulnerable_versions,
          nodes: a.findings.flatMap((f) => f.paths),
          fixAvailable: a.patched_versions !== "<0.0.0" && a.patched_versions !== "",
        };
        meta[severity] = (meta[severity] ?? 0) + 1;
        meta.total += 1;
      } else if (obj.type === "auditSummary" && obj.data.vulnerabilities) {
        Object.assign(meta, obj.data.vulnerabilities);
      }
    } catch { /* skip unparseable lines */ }
  }

  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: meta,
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 },
    },
  };
}

export interface AuditVulnerability {
  name: string;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  via: string[];
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

export interface AuditMetadata {
  vulnerabilities: {
    info: number;
    low: number;
    moderate: number;
    high: number;
    critical: number;
    total: number;
  };
  dependencies: {
    prod: number;
    dev: number;
    optional: number;
    peer: number;
    peerOptional: number;
    total: number;
  };
}

export interface AuditReport {
  auditReportVersion: number;
  vulnerabilities: Record<string, AuditVulnerability>;
  metadata: AuditMetadata;
}

function parsePnpmAudit(raw: Record<string, unknown>): AuditReport {
  const advisories = (raw.advisories ?? {}) as Record<string, {
    module_name: string;
    severity: string;
    title: string;
    vulnerable_versions: string;
    patched_versions: string;
    findings: Array<{ paths: string[] }>;
  }>;
  const rawMeta = (raw.metadata ?? {}) as {
    vulnerabilities?: { info?: number; low?: number; moderate?: number; high?: number; critical?: number };
  };
  const metaVulns = rawMeta.vulnerabilities ?? {};

  const vulnerabilities: Record<string, AuditVulnerability> = {};
  for (const [, advisory] of Object.entries(advisories)) {
    const severity = advisory.severity as AuditVulnerability["severity"];
    vulnerabilities[advisory.module_name] = {
      name: advisory.module_name,
      severity,
      via: [advisory.title],
      effects: [],
      range: advisory.vulnerable_versions,
      nodes: advisory.findings.flatMap((f) => f.paths),
      fixAvailable: advisory.patched_versions !== "<0.0.0" && advisory.patched_versions !== "",
    };
  }

  const total = Object.keys(vulnerabilities).length;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info:     metaVulns.info     ?? 0,
        low:      metaVulns.low      ?? 0,
        moderate: metaVulns.moderate ?? 0,
        high:     metaVulns.high     ?? 0,
        critical: metaVulns.critical ?? 0,
        total,
      },
      dependencies: { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 },
    },
  };
}

export function runAudit(repoPath: string): AuditReport {
  const packageJsonPath = join(repoPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`No package.json found at ${repoPath}`);
  }

  const pm = detectPackageManager(repoPath);
  const isClassicYarn = pm === "yarn" && isYarnClassic(repoPath);

  // yarn berry uses `yarn npm audit`, classic uses `yarn audit`
  const [cmd, args] =
    pm === "npm"  ? ["npm",  ["audit", "--json"]] :
    pm === "pnpm" ? ["pnpm", ["audit", "--json"]] :
    isClassicYarn ? ["yarn", ["audit", "--json"]] :
                    ["yarn", ["npm", "audit", "--json"]];

  let output: string;
  try {
    output = execFileSync(cmd, args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    // audit commands exit non-zero when vulnerabilities found — output still valid
    const execError = err as { stdout?: string; stderr?: string };
    if (execError.stdout) {
      output = execError.stdout;
    } else {
      throw new Error(`Failed to run ${cmd} audit: ${execError.stderr ?? String(err)}`);
    }
  }

  if (isClassicYarn) return parseYarnClassicAudit(output);

  const parsed = JSON.parse(output) as Record<string, unknown>;
  if (pm === "pnpm" && "advisories" in parsed) return parsePnpmAudit(parsed);
  return parsed as unknown as AuditReport;
}

export function summarizeReport(report: AuditReport): string {
  const { vulnerabilities, metadata } = report;
  const vulnCount = Object.keys(vulnerabilities).length;

  if (vulnCount === 0) {
    return "No vulnerabilities found.";
  }

  const lines: string[] = [
    `Found ${metadata.vulnerabilities.total} vulnerabilities across ${vulnCount} packages:`,
    `  critical: ${metadata.vulnerabilities.critical}`,
    `  high:     ${metadata.vulnerabilities.high}`,
    `  moderate: ${metadata.vulnerabilities.moderate}`,
    `  low:      ${metadata.vulnerabilities.low}`,
    `  info:     ${metadata.vulnerabilities.info}`,
  ];

  return lines.join("\n");
}
