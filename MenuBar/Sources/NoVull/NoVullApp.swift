import SwiftUI

@main
struct NoVullApp: App {
    @StateObject private var store = ScanStore()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(store)
        } label: {
            MenuBarIcon(severity: store.latest?.topSeverity ?? .clean, isScanning: store.isRescanning)
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuBarIcon: View {
    let severity: TopSeverity
    let isScanning: Bool

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Image(systemName: isScanning ? "arrow.triangle.2.circlepath" : severity.sfSymbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(iconColor)

            if !isScanning, severity != .clean {
                Circle()
                    .fill(dotColor)
                    .frame(width: 6, height: 6)
                    .offset(x: 2, y: -2)
            }
        }
    }

    private var iconColor: Color {
        switch severity {
        case .clean:    return .primary
        case .info:     return .blue
        case .low:      return .yellow
        case .moderate: return .orange
        case .high, .critical: return .red
        }
    }

    private var dotColor: Color {
        switch severity {
        case .critical: return .red
        case .high:     return .red
        case .moderate: return .orange
        case .low:      return .yellow
        case .info:     return .blue
        case .clean:    return .clear
        }
    }
}
