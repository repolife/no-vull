import Foundation
import Combine
import UserNotifications

@MainActor
final class ScanStore: ObservableObject {
    @Published var latest: ScanRecord? = nil
    @Published var isRescanning = false

    private let latestPath: URL
    private var fileWatcher: DispatchSourceFileSystemObject?
    private let decoder = JSONDecoder()

    init() {
        let dataDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".no-vull")
        latestPath = dataDir.appendingPathComponent("latest.json")

        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        reload()
        startWatching()
    }

    func reload() {
        guard let data = try? Data(contentsOf: latestPath),
              let record = try? decoder.decode(ScanRecord.self, from: data) else {
            return
        }
        let previous = latest?.topSeverity ?? .clean
        if record.topSeverity > previous {
            scheduleNotification(for: record)
        }
        latest = record
    }

    private func scheduleNotification(for record: ScanRecord) {
        let repoName = URL(fileURLWithPath: record.repoPath).lastPathComponent
        let content = UNMutableNotificationContent()
        content.title = "\(record.topSeverity.label) vulnerability detected"
        content.body = "\(repoName): \(record.totalVulns) \(record.totalVulns == 1 ? "vulnerability" : "vulnerabilities") found"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "no-vull-\(record.scannedAt)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func rescan() {
        guard !isRescanning, let repoPath = latest?.repoPath else { return }
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
