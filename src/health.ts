import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { NoVullConfig } from "./config.js";
import { externalJson } from "./external-calls.js";

export type RiskLevel = "healthy" | "aging" | "abandoned" | "outdated" | "risky";

export interface PackageHealth {
  name: string;
  installedVersion: string;
  latestVersion: string;
  majorsBehind: number;
  daysSincePublish: number;
  weeklyDownloads: number;
  maintainerCount: number;
  isDeprecated: boolean;
  isDev: boolean;
  license: string;
  riskLevel: RiskLevel;
  riskReasons: string[];
}

export interface HealthReport {
  checkedAt: string;
  totalDirect: number;
  packages: PackageHealth[];
  suggestedStandards: {
    maxPackageAgeDays: number;
    maxMajorsBehind: number;
    minWeeklyDownloads: number;
    minMaintainers: number;
    allowedLicenses: string[];
  };
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NpmRegistryFull {
  name: string;
  "dist-tags"?: { latest?: string };
  time?: Record<string, string>;
  maintainers?: Array<{ name: string }>;
  deprecated?: string;
  license?: string | { type: string };
  versions?: Record<string, { license?: string | { type: string } }>;
}

interface NpmDownloads {
  downloads?: number;
}

function parseLicense(raw: string | { type: string } | undefined): string {
  if (!raw) return "unknown";
  if (typeof raw === "string") return raw;
  return raw.type ?? "unknown";
}

function isLicenseAllowed(license: string, allowedLicenses: string[]): boolean {
  if (allowedLicenses.length === 0) return true;
  return allowedLicenses.some((allowed) => license.includes(allowed));
}

function readDirectDeps(repoPath: string): Array<{ name: string; isDev: boolean }> {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  const deps = Object.keys(pkg.dependencies ?? {}).map((n) => ({ name: n, isDev: false }));
  const devDeps = Object.keys(pkg.devDependencies ?? {}).map((n) => ({ name: n, isDev: true }));
  return [...deps, ...devDeps];
}

function readInstalledVersion(repoPath: string, name: string): string | null {
  // node_modules works for npm/pnpm/yarn (pnpm/yarn both symlink into node_modules)
  const nmPkgPath = join(repoPath, "node_modules", name, "package.json");
  if (existsSync(nmPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(nmPkgPath, "utf-8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch { /* fall through */ }
  }
  // Fallback: npm lockfile
  const lockPath = join(repoPath, "package-lock.json");
  if (!existsSync(lockPath)) return null;
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as {
      packages?: Record<string, { version?: string }>;
    };
    return lock.packages?.[`node_modules/${name}`]?.version ?? null;
  } catch {
    return null;
  }
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^[^0-9]*/, "");
  const parts = clean.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

async function fetchRegistryInfo(name: string): Promise<NpmRegistryFull | null> {
  try {
    const encoded = name.startsWith("@")
      ? "@" + encodeURIComponent(name.slice(1))
      : name;
    return await externalJson<NpmRegistryFull>({
      service: "npm",
      operation: "registry metadata",
      url: `https://registry.npmjs.org/${encoded}`,
      init: { headers: { Accept: "application/json" } },
      timeoutMs: 8_000,
    });
  } catch {
    return null;
  }
}

async function fetchWeeklyDownloads(name: string): Promise<number> {
  try {
    const encoded = name.startsWith("@") ? encodeURIComponent(name) : name;
    const data = await externalJson<NpmDownloads>({
      service: "npm",
      operation: "weekly downloads",
      url: `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
      timeoutMs: 5_000,
    });
    return data.downloads ?? 0;
  } catch {
    return 0;
  }
}

function classifyRisk(pkg: Omit<PackageHealth, "riskLevel" | "riskReasons">, config: NoVullConfig): { riskLevel: RiskLevel; riskReasons: string[] } {
  const reasons: string[] = [];
  const { standards } = config;

  if (config.ignore.includes(pkg.name)) return { riskLevel: "healthy", riskReasons: [] };
  if (config.exceptions[pkg.name]) return { riskLevel: "healthy", riskReasons: [] };

  // Skip dev deps if configured
  if (pkg.isDev && standards.allowDevDepsToAge) {
    if (pkg.isDeprecated) reasons.push("Deprecated by maintainer");
    if (!isLicenseAllowed(pkg.license, standards.allowedLicenses)) {
      reasons.push(`License ${pkg.license} not in allowedLicenses`);
    }
    return {
      riskLevel: reasons.length > 0 ? "risky" : "healthy",
      riskReasons: reasons,
    };
  }

  if (pkg.isDeprecated) reasons.push("Deprecated by maintainer");

  if (!isLicenseAllowed(pkg.license, standards.allowedLicenses)) {
    reasons.push(`License ${pkg.license} not in allowedLicenses`);
  }

  if (pkg.daysSincePublish > standards.maxPackageAgeDays * 2) {
    reasons.push(`No updates in ${Math.round(pkg.daysSincePublish / 365)} years — likely abandoned`);
  } else if (pkg.daysSincePublish > standards.maxPackageAgeDays) {
    reasons.push(`Last updated ${Math.round(pkg.daysSincePublish / 30)} months ago`);
  }

  if (pkg.majorsBehind > standards.maxMajorsBehind) {
    reasons.push(`${pkg.majorsBehind} major versions behind latest (${pkg.latestVersion})`);
  }

  if (pkg.weeklyDownloads < standards.minWeeklyDownloads && pkg.weeklyDownloads > 0) {
    reasons.push(`Only ${pkg.weeklyDownloads.toLocaleString()} weekly downloads — low community activity`);
  }

  if (pkg.maintainerCount < standards.minMaintainers) {
    reasons.push(`${pkg.maintainerCount} maintainer(s) — high bus-factor risk`);
  }

  let riskLevel: RiskLevel = "healthy";
  if (reasons.length > 0) {
    if (pkg.isDeprecated || pkg.daysSincePublish > standards.maxPackageAgeDays * 2) {
      riskLevel = pkg.daysSincePublish > standards.maxPackageAgeDays * 2 ? "abandoned" : "risky";
    } else if (pkg.majorsBehind > standards.maxMajorsBehind) {
      riskLevel = "outdated";
    } else {
      riskLevel = "aging";
    }
  }

  return { riskLevel, riskReasons: reasons };
}

function suggestStandards(packages: Array<Omit<PackageHealth, "riskLevel" | "riskReasons">>, config: NoVullConfig): HealthReport["suggestedStandards"] {
  const ages = packages.map((p) => p.daysSincePublish).sort((a, b) => a - b);
  const downloads = packages.map((p) => p.weeklyDownloads).filter((d) => d > 0).sort((a, b) => a - b);

  // Suggest the 75th percentile age as the limit — catch the outliers, not everyone
  const p75Age = ages[Math.floor(ages.length * 0.75)] ?? 730;
  const medianDownloads = downloads[Math.floor(downloads.length * 0.5)] ?? 500;

  return {
    maxPackageAgeDays: Math.round(Math.max(365, Math.min(p75Age, 1095)) / 30) * 30,
    maxMajorsBehind: 2,
    minWeeklyDownloads: Math.round(Math.max(100, medianDownloads * 0.1) / 100) * 100,
    minMaintainers: 1,
    allowedLicenses: config.standards.allowedLicenses,
  };
}

export async function analyzeHealth(
  repoPath: string,
  config: NoVullConfig,
  onProgress?: (done: number, total: number) => void
): Promise<HealthReport> {
  const directDeps = readDirectDeps(repoPath);
  const packages: PackageHealth[] = [];
  let done = 0;

  const CONCURRENCY = 5;
  for (let i = 0; i < directDeps.length; i += CONCURRENCY) {
    const batch = directDeps.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ name, isDev }) => {
        const installedVersion = readInstalledVersion(repoPath, name) ?? "unknown";
        const [registry, downloads] = await Promise.all([
          fetchRegistryInfo(name),
          fetchWeeklyDownloads(name),
        ]);

        const latestVersion = registry?.["dist-tags"]?.latest ?? installedVersion;
        const [installedMajor] = parseSemver(installedVersion);
        const [latestMajor] = parseSemver(latestVersion);
        const majorsBehind = Math.max(0, latestMajor - installedMajor);

        const latestPublishTime = registry?.time?.[latestVersion] ?? registry?.time?.modified ?? "";
        const daysSinceLatest = latestPublishTime ? daysSince(latestPublishTime) : 0;

        const rawLicense = registry?.versions?.[latestVersion]?.license ?? registry?.license;
        const license = parseLicense(rawLicense);

        const base: Omit<PackageHealth, "riskLevel" | "riskReasons"> = {
          name,
          installedVersion,
          latestVersion,
          majorsBehind,
          daysSincePublish: daysSinceLatest,
          weeklyDownloads: downloads,
          maintainerCount: registry?.maintainers?.length ?? 1,
          isDeprecated: !!(registry?.deprecated),
          isDev,
          license,
        };

        const { riskLevel, riskReasons } = classifyRisk(base, config);
        packages.push({ ...base, riskLevel, riskReasons });

        done++;
        onProgress?.(done, directDeps.length);
      })
    );
  }

  const prodPackages = packages.filter((p) => !p.isDev);
  const suggested = suggestStandards(prodPackages.length > 0 ? prodPackages : packages, config);

  return {
    checkedAt: new Date().toISOString(),
    totalDirect: directDeps.length,
    packages: packages.sort((a, b) => {
      const order: Record<RiskLevel, number> = { abandoned: 0, risky: 1, outdated: 2, aging: 3, healthy: 4 };
      return order[a.riskLevel] - order[b.riskLevel];
    }),
    suggestedStandards: suggested,
  };
}
