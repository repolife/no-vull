import Foundation

enum TopSeverity: String, Codable, Comparable {
    case clean, info, low, moderate, high, critical

    private var rank: Int {
        switch self {
        case .clean:    return 0
        case .info:     return 1
        case .low:      return 2
        case .moderate: return 3
        case .high:     return 4
        case .critical: return 5
        }
    }

    static func < (lhs: TopSeverity, rhs: TopSeverity) -> Bool {
        lhs.rank < rhs.rank
    }

    var color: String {
        switch self {
        case .clean:    return "green"
        case .info:     return "blue"
        case .low:      return "yellow"
        case .moderate: return "orange"
        case .high:     return "red"
        case .critical: return "red"
        }
    }

    var label: String {
        switch self {
        case .clean:    return "Clean"
        case .info:     return "Info"
        case .low:      return "Low"
        case .moderate: return "Moderate"
        case .high:     return "High"
        case .critical: return "Critical"
        }
    }

    var sfSymbol: String {
        switch self {
        case .clean:    return "checkmark.shield.fill"
        case .info:     return "info.circle.fill"
        case .low:      return "shield.fill"
        case .moderate: return "exclamationmark.shield.fill"
        case .high:     return "exclamationmark.shield.fill"
        case .critical: return "xmark.shield.fill"
        }
    }
}

struct ViralVuln: Codable, Identifiable {
    var id: String { package }
    let package: String
    let severity: String
    let affectedCount: Int
    let cvss: Double?
    let explanation: String
}

struct VulnerabilityAnalysis: Codable, Identifiable {
    var id: String { package }
    let package: String
    let severity: String
    let explanation: String
    let exploitability: String
    let remediation: String
    let command: String?
}

struct AgentReport: Codable {
    let summary: String
    let totalVulnerabilities: Int
    let actionPlan: [String]
    let vulnerabilities: [VulnerabilityAnalysis]
}

struct XTweet: Codable, Identifiable {
    var id: String
    let text: String
    let author: String
    let createdAt: String
    let url: String
    let likeCount: Int
    let retweetCount: Int

    var hoursAgo: Int {
        let fmt = ISO8601DateFormatter()
        let date = fmt.date(from: createdAt) ?? Date()
        return Int(Date().timeIntervalSince(date) / 3600)
    }
}

struct XAlert: Codable, Identifiable {
    var id: String { packageName }
    let packageName: String
    let tweets: [XTweet]
}

struct ScanRecord: Codable {
    let scannedAt: String
    let repoPath: String
    let topSeverity: TopSeverity
    let totalVulns: Int
    let viralVulns: [ViralVuln]
    let agentReport: AgentReport?
    let xAlerts: [XAlert]?

    var scannedDate: Date {
        let fmt = ISO8601DateFormatter()
        return fmt.date(from: scannedAt) ?? Date()
    }

    var timeAgo: String {
        let diff = Date().timeIntervalSince(scannedDate)
        switch diff {
        case ..<60:       return "just now"
        case ..<3600:     return "\(Int(diff / 60))m ago"
        case ..<86400:    return "\(Int(diff / 3600))h ago"
        default:          return "\(Int(diff / 86400))d ago"
        }
    }
}
