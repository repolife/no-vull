import type { ScanRecord } from "./storage.js";
import { externalFetch } from "./external-calls.js";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#cc0000",
  high:     "#cc0000",
  moderate: "#e07820",
  low:      "#d9b84a",
  info:     "#4a90d9",
  clean:    "#36a64f",
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🚨",
  high:     "🔴",
  moderate: "⚠️",
  low:      "🔵",
  info:     "ℹ️",
  clean:    "✅",
};

function buildSlackPayload(record: ScanRecord): unknown {
  const sev = record.topSeverity;
  const color = SEVERITY_COLOR[sev] ?? "#cccccc";
  const emoji = SEVERITY_EMOJI[sev] ?? "🔍";
  const repoName = record.repoPath.split("/").pop() ?? record.repoPath;
  const vulnLabel = record.totalVulns === 1 ? "vulnerability" : "vulnerabilities";

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} no-vull: ${sev === "clean" ? "No vulnerabilities found" : `${record.totalVulns} ${vulnLabel} (${sev})`}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Repo*\n${repoName}` },
        { type: "mrkdwn", text: `*Severity*\n${sev.toUpperCase()}` },
        { type: "mrkdwn", text: `*Total vulns*\n${record.totalVulns}` },
        { type: "mrkdwn", text: `*Scanned*\n<!date^${Math.floor(new Date(record.scannedAt).getTime() / 1000)}^{date_short_pretty} at {time}|${record.scannedAt}>` },
      ],
    },
  ];

  if (record.agentReport?.summary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Summary*\n${record.agentReport.summary}` },
    });
  }

  if (record.agentReport && record.agentReport.actionPlan.length > 0) {
    const steps = record.agentReport.actionPlan
      .slice(0, 5)
      .map((step, i) => `${i + 1}. ${step}`)
      .join("\n");
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Action Plan*\n${steps}` },
      }
    );
  }

  // High/critical vulns (max 3)
  const critical = record.agentReport?.vulnerabilities.filter(
    (v) => v.severity === "critical" || v.severity === "high"
  ) ?? [];
  if (critical.length > 0) {
    blocks.push({ type: "divider" });
    for (const vuln of critical.slice(0, 3)) {
      const sevEmoji = SEVERITY_EMOJI[vuln.severity] ?? "•";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${sevEmoji} *${vuln.package}* (${vuln.severity})\n${vuln.explanation}\n_Fix:_ ${vuln.remediation}${vuln.command ? `\n\`${vuln.command}\`` : ""}`,
        },
      });
    }
    if (critical.length > 3) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `…and ${critical.length - 3} more high/critical vulnerabilities` }],
      });
    }
  }

  if (record.osvFindings.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📡 ${record.osvFindings.length} additional OSV.dev finding(s)` }],
    });
  }

  return {
    attachments: [{ color, blocks }],
  };
}

export async function postWebhook(webhookUrl: string, record: ScanRecord): Promise<void> {
  const isSlack = webhookUrl.includes("hooks.slack.com") || webhookUrl.includes("slack.com/services");
  const payload = isSlack ? buildSlackPayload(record) : record;

  await externalFetch({
    service: "webhook",
    operation: "POST",
    url: webhookUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    timeoutMs: 10_000,
  });
}
