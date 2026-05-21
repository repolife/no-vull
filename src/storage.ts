import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentReport } from "./agent.js";
import type { OsvFinding } from "./osv.js";
import type { SupplyChainRisk } from "./supply-chain.js";
import type { XAlert } from "./x-monitor.js";
import type { DependentCounts } from "./viral.js";

const DATA_DIR = join(homedir(), ".no-vull");
const LATEST_PATH = join(DATA_DIR, "latest.json");
const LOG_PATH = join(DATA_DIR, "scan-log.jsonl");

export interface ScanRecord {
  scannedAt: string;
  repoPath: string;
  topSeverity: "clean" | "info" | "low" | "moderate" | "high" | "critical";
  totalVulns: number;
  viralVulns: ViralVuln[];
  agentReport: AgentReport | null;
  osvFindings: OsvFinding[];
  supplyChainRisks: SupplyChainRisk[];
  xAlerts: XAlert[];
}

export interface ViralVuln {
  package: string;
  severity: string;
  affectedCount: number;
  cvss?: number;
  explanation: string;
}

const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info", "clean"] as const;

function topSeverity(report: AgentReport | null): ScanRecord["topSeverity"] {
  if (!report || report.vulnerabilities.length === 0) return "clean";
  for (const sev of SEVERITY_ORDER) {
    if (report.vulnerabilities.some((v) => v.severity.toLowerCase() === sev)) {
      return sev as ScanRecord["topSeverity"];
    }
  }
  return "clean";
}

function detectViralVulns(report: AgentReport | null, dependentCounts: DependentCounts): ViralVuln[] {
  if (!report) return [];

  return report.vulnerabilities
    .filter((v) => {
      const sev = v.severity.toLowerCase();
      const dependents = dependentCounts.get(v.package) ?? 0;
      return sev === "critical" || v.exploitability === "high" || dependents >= 10_000;
    })
    .map((v) => ({
      package: v.package,
      severity: v.severity,
      affectedCount: dependentCounts.get(v.package) ?? 0,
      explanation: v.explanation,
    }));
}

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function writeScanResult(
  repoPath: string,
  agentReport: AgentReport | null,
  osvFindings: OsvFinding[],
  supplyChainRisks: SupplyChainRisk[],
  xAlerts: XAlert[],
  dependentCounts: DependentCounts = new Map()
): ScanRecord {
  ensureDataDir();

  const record: ScanRecord = {
    scannedAt: new Date().toISOString(),
    repoPath,
    topSeverity: topSeverity(agentReport),
    totalVulns: agentReport?.totalVulnerabilities ?? 0,
    viralVulns: detectViralVulns(agentReport, dependentCounts),
    agentReport,
    osvFindings,
    supplyChainRisks,
    xAlerts,
  };

  writeFileSync(LATEST_PATH, JSON.stringify(record, null, 2), "utf-8");
  appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8");

  return record;
}

export function readLatest(): ScanRecord | null {
  if (!existsSync(LATEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LATEST_PATH, "utf-8")) as ScanRecord;
  } catch {
    return null;
  }
}

export function readLog(limit = 50): ScanRecord[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const lines = readFileSync(LOG_PATH, "utf-8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit);
    return lines.map((l) => JSON.parse(l) as ScanRecord);
  } catch {
    return [];
  }
}
