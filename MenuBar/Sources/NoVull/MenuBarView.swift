import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var store: ScanStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            githubStatusSection
            Divider()
            if let record = store.latest {
                if record.viralVulns.isEmpty == false {
                    viralSection(record.viralVulns)
                    Divider()
                }
                if let report = record.agentReport, !report.vulnerabilities.isEmpty {
                    vulnList(report.vulnerabilities)
                    Divider()
                }
                if let alerts = record.xAlerts, !alerts.isEmpty {
                    xAlertsSection(alerts)
                    Divider()
                }
                actionPlan(record)
                Divider()
            } else {
                Text("No scan data yet.")
                    .foregroundStyle(.secondary)
                    .padding()
            }
            footer
        }
        .frame(width: 340)
        .onAppear {
            store.refreshForPopoverOpen()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("no-vull")
                    .font(.headline)
                if let record = store.latest {
                    Text(record.repoPath.components(separatedBy: "/").last ?? record.repoPath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Scanned \(record.timeAgo)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            severityBadge
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - GitHub Status

    private var githubStatusSection: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: githubStatusIcon)
                .foregroundStyle(githubStatusColor)
                .font(.caption)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("GitHub")
                        .font(.caption.weight(.semibold))
                    Text(githubStatusLabel)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(githubStatusColor)
                }

                if let status = store.githubStatus {
                    if status.isDegraded {
                        Text(githubStatusDetail(status))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    } else {
                        Text(status.status?.description ?? "All Systems Operational")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Status unavailable")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button(action: { Task { await store.refreshGitHubStatus() } }) {
                Image(systemName: store.isRefreshingGitHubStatus ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .disabled(store.isRefreshingGitHubStatus)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var severityBadge: some View {
        Group {
            if let sev = store.latest?.topSeverity {
                Label(sev.label, systemImage: sev.sfSymbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(severityColor(sev))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(severityColor(sev).opacity(0.15))
                    .clipShape(Capsule())
            }
        }
    }

    // MARK: - Viral vulns

    private func viralSection(_ vulns: [ViralVuln]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Viral / High-Impact", systemImage: "flame.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.red)
                .padding(.horizontal, 12)
                .padding(.top, 8)

            ForEach(vulns) { vuln in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.caption)
                        .frame(width: 14)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(vuln.package)
                                .font(.caption.weight(.semibold))
                            if vuln.affectedCount > 0 {
                                Text("↑ \(formatDependents(vuln.affectedCount)) dependents")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }
                        Text(vuln.explanation)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.horizontal, 12)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: - Vuln list

    private func vulnList(_ vulns: [VulnerabilityAnalysis]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("All Vulnerabilities")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 4)

            ForEach(vulns.prefix(5)) { vuln in
                HStack(spacing: 8) {
                    Circle()
                        .fill(severityColor(severityFromString(vuln.severity)))
                        .frame(width: 7, height: 7)
                    Text(vuln.package)
                        .font(.caption)
                    Spacer()
                    Text(vuln.severity.lowercased())
                        .font(.caption2)
                        .foregroundStyle(severityColor(severityFromString(vuln.severity)))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
            }

            if vulns.count > 5 {
                Text("+ \(vulns.count - 5) more")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: - Action plan

    private func actionPlan(_ record: ScanRecord) -> some View {
        Group {
            if let plan = record.agentReport?.actionPlan, !plan.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Action Plan")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)

                    ForEach(Array(plan.prefix(3).enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 6) {
                            Text("\(i + 1).")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 14, alignment: .trailing)
                            Text(step)
                                .font(.caption2)
                                .foregroundStyle(.primary)
                                .lineLimit(2)
                        }
                        .padding(.horizontal, 12)
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - X Alerts

    private func xAlertsSection(_ alerts: [XAlert]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("X / Security Chatter", systemImage: "bubble.left.and.bubble.right.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.blue)
                .padding(.horizontal, 12)
                .padding(.top, 8)

            ForEach(alerts.prefix(3)) { alert in
                if let tweet = alert.tweets.first {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(alert.packageName)
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Text("\(tweet.likeCount)♥ \(tweet.retweetCount)↺")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text("· \(tweet.hoursAgo)h ago")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Text(tweet.text)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Button(action: {
                            if let url = URL(string: tweet.url) {
                                NSWorkspace.shared.open(url)
                            }
                        }) {
                            Text("View on X →")
                                .font(.caption2)
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 2)
                }
            }

            if alerts.count > 3 {
                Text("+ \(alerts.count - 3) more packages with chatter")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Button(action: { store.rescan() }) {
                Label(
                    store.isRescanning ? "Scanning…" : "Re-scan",
                    systemImage: store.isRescanning ? "arrow.triangle.2.circlepath" : "arrow.clockwise"
                )
                .font(.caption)
            }
            .buttonStyle(.plain)
            .disabled(store.isRescanning || store.latest == nil)

            Spacer()

            Button("Quit") { NSApplication.shared.terminate(nil) }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Helpers

    private func severityColor(_ sev: TopSeverity) -> Color {
        switch sev {
        case .clean:    return .green
        case .info:     return .blue
        case .low:      return .yellow
        case .moderate: return .orange
        case .high:     return .red
        case .critical: return .red
        }
    }

    private func severityFromString(_ s: String) -> TopSeverity {
        TopSeverity(rawValue: s.lowercased()) ?? .info
    }

    private func formatDependents(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000     { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }

    private var githubStatusLabel: String {
        guard let status = store.githubStatus else { return "Unknown" }
        if status.isDegraded { return status.status?.description ?? "Degraded" }
        return "Operational"
    }

    private var githubStatusIcon: String {
        guard let status = store.githubStatus else { return "questionmark.circle.fill" }
        return status.isDegraded ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"
    }

    private var githubStatusColor: Color {
        guard let status = store.githubStatus else { return .secondary }
        return status.isDegraded ? .orange : .green
    }

    private func githubStatusDetail(_ status: GitHubStatusSummary) -> String {
        if let incident = status.activeIncidents.first {
            return "\(incident.name) (\(incident.impact))"
        }
        let names = status.degradedComponents.prefix(2).map(\.name).joined(separator: ", ")
        if names.isEmpty { return status.status?.description ?? "Service degraded" }
        let suffix = status.degradedComponents.count > 2 ? " +" : ""
        return "\(names)\(suffix)"
    }
}
