import Foundation
import Combine
import UserNotifications

@MainActor
final class ScanStore: ObservableObject {
    @Published var latest: ScanRecord? = nil
    @Published var targetRepo: String? = nil
    @Published var isRescanning = false
    @Published var githubStatus: GitHubStatusSummary? = nil
    @Published var isRefreshingGitHubStatus = false

    private let latestPath: URL
    private let targetPath: URL
    private var fileWatcher: DispatchSourceFileSystemObject?
    private let decoder = JSONDecoder()
    private let githubStatusURL = URL(string: "https://www.githubstatus.com/api/v2/summary.json")!

    init() {
        let dataDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".no-vull")
        latestPath = dataDir.appendingPathComponent("latest.json")
        targetPath = dataDir.appendingPathComponent("target.json")

        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        reload()
        startWatching()
        Task { await refreshGitHubStatus() }
    }

    func reload() {
        targetRepo = readTargetRepo()
        guard let data = try? Data(contentsOf: latestPath),
              let record = try? decoder.decode(ScanRecord.self, from: data) else {
            return
        }
        let previous = latest?.topSeverity ?? .clean
        let previousVulns = latest?.totalVulns ?? 0
        if record.topSeverity > previous || record.totalVulns > previousVulns {
            scheduleVulnNotification(for: record)
        }
        if let alerts = record.xAlerts, !alerts.isEmpty {
            let previousIDs = Set(latest?.xAlerts?.flatMap { $0.tweets.map(\.id) } ?? [])
            let newAlerts = alerts.filter { alert in
                alert.tweets.contains { !previousIDs.contains($0.id) }
            }
            if !newAlerts.isEmpty {
                scheduleXNotification(newAlerts: newAlerts, record: record)
            }
        }
        latest = record
    }

    func refreshForPopoverOpen() {
        targetRepo = readTargetRepo()
        Task { await refreshGitHubStatus() }
        rescan()
    }

    func refreshGitHubStatus() async {
        guard !isRefreshingGitHubStatus else { return }
        isRefreshingGitHubStatus = true
        defer { isRefreshingGitHubStatus = false }

        var request = URLRequest(url: githubStatusURL, timeoutInterval: 5)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return
            }
            githubStatus = try decoder.decode(GitHubStatusSummary.self, from: data)
        } catch {
            githubStatus = nil
        }
    }

    private func scheduleVulnNotification(for record: ScanRecord) {
        let repoName = URL(fileURLWithPath: record.repoPath).lastPathComponent
        let content = UNMutableNotificationContent()
        content.title = "\(record.topSeverity.label) vulnerability detected"
        content.body = "\(repoName): \(record.totalVulns) \(record.totalVulns == 1 ? "vulnerability" : "vulnerabilities") found"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "no-vull-vuln-\(record.scannedAt)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func scheduleXNotification(newAlerts: [XAlert], record: ScanRecord) {
        let repoName = URL(fileURLWithPath: record.repoPath).lastPathComponent
        let content = UNMutableNotificationContent()
        content.title = "Security chatter on X"

        if newAlerts.count == 1, let tweet = newAlerts[0].tweets.first {
            content.body = "\(newAlerts[0].packageName): @\(tweet.author) — \(String(tweet.text.prefix(100)))"
        } else {
            let names = newAlerts.prefix(3).map(\.packageName).joined(separator: ", ")
            content.body = "\(repoName): new security tweets about \(names)"
        }
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "no-vull-x-\(record.scannedAt)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func readTargetRepo() -> String? {
        guard let data = try? Data(contentsOf: targetPath),
              let target = try? decoder.decode(TargetConfig.self, from: data) else {
            return nil
        }
        return target.repoPath
    }

    func rescan() {
        guard !isRescanning, let repoPath = targetRepo ?? latest?.repoPath else { return }
        isRescanning = true

        Task.detached { [repoPath] in
            let process = Process()
            // Resolve no-vull binary — try common install locations
            let candidates = [
                "/usr/local/bin/no-vull",
                "\(FileManager.default.homeDirectoryForCurrentUser.path)/.local/bin/no-vull",
                "/opt/homebrew/bin/no-vull",
            ]
            guard let bin = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
                await MainActor.run { self.isRescanning = false }
                return
            }
            process.executableURL = URL(fileURLWithPath: bin)
            process.arguments = [repoPath]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            await MainActor.run { self.isRescanning = false }
        }
    }

    private func startWatching() {
        let fd = open(latestPath.path, O_EVTONLY)
        guard fd >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: .write,
            queue: .main
        )
        source.setEventHandler { [weak self] in
            // Small delay so the file finishes writing before we read
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self?.reload()
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        fileWatcher = source
    }
}
