import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { externalJson } from "./external-calls.js";

export interface SupplyChainRisk {
  package: string;
  version: string;
  risk: "high" | "medium" | "low";
  reasons: string[];
}

interface NpmRegistryMeta {
  name: string;
  time?: Record<string, string>;
  maintainers?: Array<{ name: string }>;
  versions?: Record<string, {
    scripts?: Record<string, string>;
    maintainers?: Array<{ name: string }>;
    _npmUser?: { name: string };
    dist?: { tarball?: string };
  }>;
}

interface PackageLock {
  packages?: Record<string, { version?: string; resolved?: string }>;
}

function readInstalledPackages(repoPath: string): Array<{ name: string; version: string }> {
  const lockPath = join(repoPath, "package-lock.json");
  if (!existsSync(lockPath)) return [];

  let lock: PackageLock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf-8")) as PackageLock;
  } catch {
    return [];
  }

  const packages: Array<{ name: string; version: string }> = [];
  if (lock.packages) {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path || path === "" || !meta?.version) continue;
      const name = path.replace(/^node_modules\//, "").replace(/\/node_modules\//, "/");
      packages.push({ name, version: meta.version });
    }
  }
  return packages;
}

async function fetchRegistryMeta(packageName: string): Promise<NpmRegistryMeta | null> {
  try {
    const encoded = packageName.startsWith("@")
      ? "@" + encodeURIComponent(packageName.slice(1))
      : packageName;
    return await externalJson<NpmRegistryMeta>({
      service: "npm",
      operation: "supply-chain registry metadata",
      url: `https://registry.npmjs.org/${encoded}`,
      init: { headers: { Accept: "application/json" } },
      timeoutMs: 8_000,
    });
  } catch {
    return null;
  }
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function analyzePackage(
  name: string,
  version: string,
  meta: NpmRegistryMeta
): SupplyChainRisk | null {
  const reasons: string[] = [];
  let maxRisk: "high" | "medium" | "low" = "low";

  const versionMeta = meta.versions?.[version];
  if (!versionMeta) return null;

  // Install scripts — primary attack vector
  const dangerousScripts = ["preinstall", "install", "postinstall"];
  const scripts = versionMeta.scripts ?? {};
  const presentScripts = dangerousScripts.filter((s) => scripts[s]);
  if (presentScripts.length > 0) {
    reasons.push(`Has install scripts: ${presentScripts.join(", ")}`);
    maxRisk = "medium";
  }

  // Very recently published version (within 7 days)
  const publishTime = meta.time?.[version];
  if (publishTime) {
    const age = daysSince(publishTime);
    if (age < 2) {
      reasons.push(`Version published ${age.toFixed(1)} days ago — very new`);
      maxRisk = "high";
    } else if (age < 7) {
      reasons.push(`Version published ${age.toFixed(0)} days ago — recently released`);
      if (maxRisk === "low") maxRisk = "medium";
    }
  }

  // Publisher not in current maintainer list (possible account takeover)
  // Skip known CI automation accounts — they publish on behalf of maintainers
  const CI_BOTS = new Set([
    "github actions",
    "github-actions",
    "github-actions[bot]",
    "npm-bot",
    "release-bot",
    "semantic-release-bot",
  ]);
  const pkgMaintainers = (meta.maintainers ?? []).map((m) => m.name);
  const versionPublisher = versionMeta._npmUser?.name;
  if (
    versionPublisher &&
    !CI_BOTS.has(versionPublisher.toLowerCase()) &&
    pkgMaintainers.length > 0 &&
    !pkgMaintainers.includes(versionPublisher)
  ) {
    reasons.push(`Published by "${versionPublisher}" who is not in current maintainer list`);
    maxRisk = "high";
  }

  // Scoped packages resolving outside their scope (typosquatting / dependency confusion)
  if (!name.startsWith("@") && name.includes(".")) {
    reasons.push("Package name contains dots — possible typosquatting");
    if (maxRisk === "low") maxRisk = "medium";
  }

  if (reasons.length === 0) return null;

  return { package: name, version, risk: maxRisk, reasons };
}

export async function checkSupplyChain(
  repoPath: string,
  onProgress?: (done: number, total: number) => void
): Promise<SupplyChainRisk[]> {
  const packages = readInstalledPackages(repoPath);
  if (packages.length === 0) return [];

  // Limit to direct + 1st-level transitive to keep it fast
  const MAX_PACKAGES = 150;
  const toCheck = packages.slice(0, MAX_PACKAGES);

  const risks: SupplyChainRisk[] = [];
  let done = 0;

  // Fetch in parallel with concurrency limit
  const CONCURRENCY = 10;
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (pkg) => {
        const meta = await fetchRegistryMeta(pkg.name);
        if (meta) {
          const risk = analyzePackage(pkg.name, pkg.version, meta);
          if (risk) risks.push(risk);
        }
        done++;
        onProgress?.(done, toCheck.length);
      })
    );
  }

  return risks.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.risk] - order[b.risk];
  });
}

export function formatSupplyChainRisks(risks: SupplyChainRisk[]): string {
  if (risks.length === 0) return "";

  const high = risks.filter((r) => r.risk === "high");
  const medium = risks.filter((r) => r.risk === "medium");

  const lines: string[] = [
    `Supply-chain check flagged ${risks.length} package(s):\n`,
  ];

  for (const r of [...high, ...medium]) {
    const icon = r.risk === "high" ? "[HIGH]" : "[MED] ";
    lines.push(`  ${icon} ${r.package}@${r.version}`);
    for (const reason of r.reasons) {
      lines.push(`         ${reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
