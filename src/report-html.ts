import type { ScanRecord } from "./storage.js";
import { formatDependentCount } from "./viral.js";

const SEV_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5" },
  high:     { bg: "#fff7ed", text: "#ea580c", border: "#fdba74" },
  moderate: { bg: "#fefce8", text: "#ca8a04", border: "#fde047" },
  low:      { bg: "#eff6ff", text: "#2563eb", border: "#93c5fd" },
  info:     { bg: "#f0fdf4", text: "#16a34a", border: "#86efac" },
  clean:    { bg: "#f0fdf4", text: "#16a34a", border: "#86efac" },
};

function sevBadge(sev: string): string {
  const c = SEV_COLOR[sev.toLowerCase()] ?? { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
  return `<span style="background:${c.bg};color:${c.text};border:1px solid ${c.border};padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;white-space:nowrap">${sev.toUpperCase()}</span>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function generateHtmlReport(record: ScanRecord): string {
  const repoName = record.repoPath.split("/").pop() ?? record.repoPath;
  const topC = SEV_COLOR[record.topSeverity] ?? SEV_COLOR.clean;
  const vulns = record.agentReport?.vulnerabilities ?? [];
  const actionPlan = record.agentReport?.actionPlan ?? [];
  const summary = record.agentReport?.summary ?? "";

  // ─── Vuln rows ────────────────────────────────────────────────────────────
  const viralMap = new Map(record.viralVulns.map((v) => [v.package, v.affectedCount]));
  const vulnRows = vulns.map((v) => {
    const deps = viralMap.get(v.package) ?? 0;
    const depsCell = deps > 0
      ? `<span style="color:#ea580c;font-weight:600">${formatDependentCount(deps)}</span>`
      : `<span style="color:#9ca3af">—</span>`;
    return `
    <tr data-pkg="${esc(v.package)}" data-sev="${v.severity}" data-expl="${v.exploitability}">
      <td style="font-weight:600">${esc(v.package)}</td>
      <td>${sevBadge(v.severity)}</td>
      <td>${sevBadge(v.exploitability)}</td>
      <td style="text-align:right">${depsCell}</td>
      <td style="max-width:300px">${esc(v.explanation)}</td>
      <td style="max-width:220px">
        <div>${esc(v.remediation)}</div>
        ${v.command ? `<code style="display:block;margin-top:4px;background:#f3f4f6;padding:4px 8px;border-radius:4px;font-size:12px">${esc(v.command)}</code>` : ""}
      </td>
    </tr>`;
  }).join("");

  // ─── OSV section ──────────────────────────────────────────────────────────
  const osvSection = record.osvFindings.length === 0 ? "" : `
  <section>
    <h2>OSV.dev Findings <span style="font-size:14px;font-weight:400;color:#6b7280">(${record.osvFindings.length} package${record.osvFindings.length === 1 ? "" : "s"})</span></h2>
    <table>
      <thead><tr><th>Package</th><th>Version</th><th>Advisory</th><th>Summary</th><th>Aliases</th></tr></thead>
      <tbody>
        ${record.osvFindings.flatMap((f) =>
          f.vulnerabilities.map((v) => `
          <tr>
            <td style="font-weight:600">${esc(f.packageName)}</td>
            <td><code>${esc(f.version)}</code></td>
            <td><code>${esc(v.id)}</code></td>
            <td>${esc(v.summary)}</td>
            <td style="font-size:12px">${(v.aliases ?? []).map(esc).join(", ")}</td>
          </tr>`)
        ).join("")}
      </tbody>
    </table>
  </section>`;

  // ─── Supply chain section ─────────────────────────────────────────────────
  const scSection = record.supplyChainRisks.length === 0 ? "" : `
  <section>
    <h2>Supply-Chain Risks <span style="font-size:14px;font-weight:400;color:#6b7280">(${record.supplyChainRisks.length})</span></h2>
    <table>
      <thead><tr><th>Package</th><th>Version</th><th>Risk</th><th>Reasons</th></tr></thead>
      <tbody>
        ${record.supplyChainRisks.map((r) => `
        <tr>
          <td style="font-weight:600">${esc(r.package)}</td>
          <td><code>${esc(r.version)}</code></td>
          <td>${sevBadge(r.risk)}</td>
          <td>${r.reasons.map(esc).join("<br>")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;

  // ─── Action plan ──────────────────────────────────────────────────────────
  const actionSection = actionPlan.length === 0 ? "" : `
  <section>
    <h2>Action Plan</h2>
    <ol style="padding-left:20px;line-height:1.8">
      ${actionPlan.map((step) => `<li>${esc(step)}</li>`).join("")}
    </ol>
  </section>`;

  // ─── Stats row ────────────────────────────────────────────────────────────
  const counts = (["critical", "high", "moderate", "low", "info"] as const).map((sev) => {
    const n = vulns.filter((v) => v.severity === sev).length;
    return n > 0
      ? `<div style="text-align:center"><div style="font-size:24px;font-weight:700;color:${SEV_COLOR[sev].text}">${n}</div><div style="font-size:12px;color:#6b7280;text-transform:uppercase">${sev}</div></div>`
      : "";
  }).filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>no-vull — ${esc(repoName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.6; color: #111827; background: #f9fafb; margin: 0; padding: 0; }
    header { background: #111827; color: #f9fafb; padding: 24px 32px; }
    header h1 { margin: 0 0 4px; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    header .meta { color: #9ca3af; font-size: 13px; }
    .severity-strip { background: ${topC.bg}; border-bottom: 3px solid ${topC.border}; padding: 12px 32px; display: flex; align-items: center; gap: 12px; }
    .severity-strip .label { font-weight: 700; font-size: 18px; color: ${topC.text}; }
    main { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; }
    h2 { margin: 0 0 14px; font-size: 16px; color: #374151; }
    .stats { display: flex; gap: 32px; flex-wrap: wrap; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: #f3f4f6; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; cursor: pointer; user-select: none; white-space: nowrap; }
    th:hover { background: #e5e7eb; }
    th .sort-icon { margin-left: 4px; opacity: 0.4; }
    th.asc .sort-icon::after { content: " ▲"; }
    th.desc .sort-icon::after { content: " ▼"; }
    th:not(.asc):not(.desc) .sort-icon::after { content: " ⇅"; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f9fafb; }
    code { font-family: "SF Mono", "Fira Code", monospace; font-size: 12px; }
    .summary-text { color: #374151; line-height: 1.7; }
    @media print { body { background: #fff; } section { border: 1px solid #ccc; break-inside: avoid; } }
  </style>
</head>
<body>

<header>
  <h1>🛡️ no-vull</h1>
  <div class="meta">${esc(record.repoPath)} &nbsp;·&nbsp; Scanned ${formatDate(record.scannedAt)}</div>
</header>

<div class="severity-strip">
  <span class="label">${record.topSeverity === "clean" ? "✅ No vulnerabilities found" : `${record.totalVulns} vulnerabilit${record.totalVulns === 1 ? "y" : "ies"} — ${record.topSeverity.toUpperCase()}`}</span>
  ${record.osvFindings.length > 0 ? `<span style="color:#6b7280;font-size:13px">· ${record.osvFindings.length} OSV finding${record.osvFindings.length === 1 ? "" : "s"}</span>` : ""}
  ${record.supplyChainRisks.length > 0 ? `<span style="color:#6b7280;font-size:13px">· ${record.supplyChainRisks.length} supply-chain risk${record.supplyChainRisks.length === 1 ? "" : "s"}</span>` : ""}
</div>

<main>
  ${summary ? `
  <section>
    <h2>Summary</h2>
    <p class="summary-text">${esc(summary)}</p>
    ${counts ? `<div class="stats" style="margin-top:16px">${counts}</div>` : ""}
  </section>` : ""}

  ${actionSection}

  ${vulns.length > 0 ? `
  <section>
    <h2>Vulnerabilities <span style="font-size:14px;font-weight:400;color:#6b7280">(${vulns.length})</span></h2>
    <table id="vuln-table">
      <thead>
        <tr>
          <th data-col="0">Package<span class="sort-icon"></span></th>
          <th data-col="1">Severity<span class="sort-icon"></span></th>
          <th data-col="2">Exploitability<span class="sort-icon"></span></th>
          <th data-col="3" style="text-align:right">Dependents<span class="sort-icon"></span></th>
          <th>Explanation</th>
          <th>Remediation</th>
        </tr>
      </thead>
      <tbody>${vulnRows}</tbody>
    </table>
  </section>` : ""}

  ${osvSection}
  ${scSection}

  <footer style="text-align:center;color:#9ca3af;font-size:12px;padding:16px 0">
    Generated by <strong>no-vull</strong> · ${formatDate(record.scannedAt)}
  </footer>
</main>

<script>
(function() {
  var table = document.getElementById("vuln-table");
  if (!table) return;
  var thead = table.querySelector("thead");
  var tbody = table.querySelector("tbody");
  var sortCol = -1, sortAsc = true;

  var SEV_RANK = { critical: 5, high: 4, moderate: 3, low: 2, info: 1, clean: 0 };
  var EXPL_RANK = { high: 3, medium: 2, low: 1 };

  function cellVal(row, col) {
    var cells = row.querySelectorAll("td");
    return cells[col] ? cells[col].textContent.trim().toLowerCase() : "";
  }

  function rankVal(val, col) {
    if (col === 1) return SEV_RANK[val] ?? 0;
    if (col === 2) return EXPL_RANK[val] ?? 0;
    return val;
  }

  thead.querySelectorAll("th[data-col]").forEach(function(th) {
    th.addEventListener("click", function() {
      var col = parseInt(th.getAttribute("data-col"));
      if (sortCol === col) { sortAsc = !sortAsc; }
      else { sortCol = col; sortAsc = false; }

      thead.querySelectorAll("th").forEach(function(h) { h.classList.remove("asc", "desc"); });
      th.classList.add(sortAsc ? "asc" : "desc");

      var rows = Array.from(tbody.querySelectorAll("tr"));
      rows.sort(function(a, b) {
        var av = rankVal(cellVal(a, col), col);
        var bv = rankVal(cellVal(b, col), col);
        if (av < bv) return sortAsc ? -1 : 1;
        if (av > bv) return sortAsc ? 1 : -1;
        return 0;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    });
  });
})();
</script>
</body>
</html>`;
}
