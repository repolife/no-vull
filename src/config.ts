import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface NoVullConfig {
  standards: {
    maxPackageAgeDays: number;
    maxMajorsBehind: number;
    minWeeklyDownloads: number;
    minMaintainers: number;
    allowDevDepsToAge: boolean;
    allowedLicenses: string[];
  };
  ignore: string[];
  exceptions: Record<string, { reason: string; until?: string }>;
}

export const CONFIG_FILENAME = "no-vull.config.json";

export const DEFAULTS: NoVullConfig = {
  standards: {
    maxPackageAgeDays: 730,
    maxMajorsBehind: 2,
    minWeeklyDownloads: 500,
    minMaintainers: 1,
    allowDevDepsToAge: true,
    allowedLicenses: [],
  },
  ignore: [],
  exceptions: {},
};

export function loadConfig(repoPath: string): NoVullConfig {
  const configPath = join(repoPath, CONFIG_FILENAME);
  if (!existsSync(configPath)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<NoVullConfig>;
    return {
      standards: { ...DEFAULTS.standards, ...(raw.standards ?? {}) },
      ignore: raw.ignore ?? [],
      exceptions: raw.exceptions ?? {},
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeConfig(repoPath: string, config: NoVullConfig): void {
  const configPath = join(repoPath, CONFIG_FILENAME);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
