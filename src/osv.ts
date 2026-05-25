import { readFileSync } from "fs";
import { join } from "path";
import { externalJson } from "./external-calls.js";

export interface OsvVulnerability {
  id: string;
  summary: string;
  severity?: Array<{ type: string; score: string }>;
  aliases?: string[];
  affected: Array<{
    package: { ecosystem: string; name: string };
    ranges?: Array<{
      type: string;
      events: Array<{ introduced?: string; fixed?: string }>;
    }>;
  }>;
  references?: Array<{ type: string; url: string }>;
}

export interface OsvFinding {
  packageName: string;
  version: string;
  vulnerabilities: OsvVulnerability[];
}

interface PackageLockV2 {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string }>;
}

function readInstalledPackages(repoPath: string): Array<{ name: string; version: string }> {
  const lockPath = join(repoPath, "package-lock.json");
  let lock: PackageLockV2;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf-8")) as PackageLockV2;
  } catch {
    return [];
  }

  const packages: Array<{ name: string; version: string }> = [];

  if (lock.packages && typeof lock.packages === "object") {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path || path === "" || !meta?.version) continue;
      const name = path.replace(/^node_modules\//, "").replace(/\/node_modules\//, "/");
      packages.push({ name, version: meta.version });
    }
  }

  return packages;
}

async function queryOsv(packages: Array<{ name: string; version: string }>): Promise<OsvFinding[]> {
  const queries = packages.map((pkg) => ({
    version: { name: pkg.name, version: pkg.version, ecosystem: "npm" },
  }));

  const data = await externalJson<{
    results: Array<{ vulns?: OsvVulnerability[] }>;
  }>({
    service: "osv",
    operation: "batch query",
    url: "https://api.osv.dev/v1/querybatch",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
    },
    timeoutMs: 15_000,
  });

  const findings: OsvFinding[] = [];
  data.results.forEach((result, i) => {
    if (result.vulns && result.vulns.length > 0) {
      findings.push({
        packageName: packages[i].name,
        version: packages[i].version,
        vulnerabilities: result.vulns,
      });
    }
  });

  return findings;
}

export async function checkOsv(repoPath: string): Promise<OsvFinding[]> {
  const packages = readInstalledPackages(repoPath);
  if (packages.length === 0) return [];

  // OSV batch API accepts max 1000 queries — chunk large projects
  const BATCH_SIZE = 500;
  const allFindings: OsvFinding[] = [];

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const batch = packages.slice(i, i + BATCH_SIZE);
    const findings = await queryOsv(batch);
    allFindings.push(...findings);
  }

  return allFindings;
}

export function formatOsvFindings(findings: OsvFinding[]): string {
  if (findings.length === 0) return "";

  const lines = [
    `\nOSV.dev found ${findings.length} additional package(s) with advisories:\n`,
  ];

  for (const finding of findings) {
    lines.push(`  ${finding.packageName}@${finding.version}`);
    for (const vuln of finding.vulnerabilities) {
      const severity = vuln.severity?.[0]?.score ?? "unknown";
      const aliases = vuln.aliases?.join(", ") ?? "";
      lines.push(`    ${vuln.id} — ${vuln.summary}`);
      if (aliases) lines.push(`    Aliases: ${aliases}`);
      if (severity !== "unknown") lines.push(`    CVSS: ${severity}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
