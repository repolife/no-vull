import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { join, resolve, isAbsolute } from "path";
import { ensureDataDir } from "./storage.js";

const DATA_DIR = join(homedir(), ".no-vull");
const TARGET_PATH = join(DATA_DIR, "target.json");

const HOOK_BEGIN = "# >>> no-vull scan-on-pull >>>";
const HOOK_END = "# <<< no-vull scan-on-pull <<<";

// post-merge covers `git pull`; post-rewrite covers `git pull --rebase`
export const HOOK_NAMES = ["post-merge", "post-rewrite"] as const;

export interface TargetConfig {
  repoPath: string;
  setAt: string;
}

export function readTarget(): TargetConfig | null {
  if (!existsSync(TARGET_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TARGET_PATH, "utf-8")) as TargetConfig;
  } catch {
    return null;
  }
}

export function writeTarget(repoPath: string): TargetConfig {
  ensureDataDir();
  const target: TargetConfig = { repoPath, setAt: new Date().toISOString() };
  writeFileSync(TARGET_PATH, JSON.stringify(target, null, 2), "utf-8");
  return target;
}

export function clearTarget(): void {
  if (existsSync(TARGET_PATH)) unlinkSync(TARGET_PATH);
}

function hooksDir(repoPath: string): string {
  const out = execFileSync("git", ["-C", repoPath, "rev-parse", "--git-path", "hooks"], {
    encoding: "utf-8",
  }).trim();
  return isAbsolute(out) ? out : resolve(repoPath, out);
}

function hookBlock(scanCmd: string[], repoPath: string): string {
  const cmd = [...scanCmd, repoPath].map((p) => `"${p}"`).join(" ");
  return `${HOOK_BEGIN}\n${cmd} >> "$HOME/.no-vull/hook.log" 2>&1 &\n${HOOK_END}\n`;
}

function stripBlock(content: string): string {
  const begin = content.indexOf(HOOK_BEGIN);
  if (begin === -1) return content;
  const end = content.indexOf(HOOK_END, begin);
  if (end === -1) return content;
  return content.slice(0, begin) + content.slice(end + HOOK_END.length + 1);
}

/** Install (or refresh) scan-on-pull hooks. Returns the hook file paths written. */
export function installHooks(repoPath: string, scanCmd: string[]): string[] {
  const dir = hooksDir(repoPath);
  const block = hookBlock(scanCmd, repoPath);
  const written: string[] = [];

  for (const name of HOOK_NAMES) {
    const hookPath = join(dir, name);
    if (!existsSync(hookPath)) {
      writeFileSync(hookPath, `#!/bin/sh\n${block}`, "utf-8");
    } else {
      // Preserve any existing hook content; replace only our managed block
      const existing = stripBlock(readFileSync(hookPath, "utf-8"));
      writeFileSync(hookPath, existing.replace(/\n*$/, "\n") + block, "utf-8");
    }
    chmodSync(hookPath, 0o755);
    written.push(hookPath);
  }
  return written;
}

/** Remove the managed block from scan-on-pull hooks. Returns the hook paths touched. */
export function removeHooks(repoPath: string): string[] {
  const dir = hooksDir(repoPath);
  const touched: string[] = [];

  for (const name of HOOK_NAMES) {
    const hookPath = join(dir, name);
    if (!existsSync(hookPath)) continue;
    const content = readFileSync(hookPath, "utf-8");
    if (!content.includes(HOOK_BEGIN)) continue;
    const stripped = stripBlock(content);
    if (stripped.replace(/^#!.*\n?/, "").trim() === "") {
      unlinkSync(hookPath);
    } else {
      writeFileSync(hookPath, stripped, "utf-8");
    }
    touched.push(hookPath);
  }
  return touched;
}

/**
 * Resolve the command used to invoke no-vull from a git hook.
 * Prefers the linked binary; falls back to `node dist/cli.js`.
 */
export function resolveScanCommand(): string[] {
  try {
    const bin = execFileSync("which", ["no-vull"], { encoding: "utf-8" }).trim();
    if (bin) return [bin];
  } catch {
    /* not linked — fall through */
  }
  return [process.execPath, resolve(process.argv[1])];
}
