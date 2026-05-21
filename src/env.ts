import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve, join } from "path";

function loadFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function config(): void {
  // Global config — always checked, used by menu bar rescan
  loadFile(join(homedir(), ".no-vull", ".env"));
  // Project-level config — overrides global
  loadFile(resolve(process.cwd(), ".env"));
}
