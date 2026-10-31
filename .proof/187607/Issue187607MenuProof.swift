import AppKit
import ApplicationServices
import Foundation
import Network
import Testing
@testable import OpenClaw

/// Proof-only test: real AppKit tracking and mouse selection over real loopback WebSockets.
/// Installed only in the disposable CI checkout, never in the product candidate diff.
@Suite(.serialized, .testWaitLimit)
@MainActor
struct Issue187607MenuProof {
    @Test func trackedPreferenceMenusAndActions() async throws {
        try await AppKitTestSupport.startApplication()
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let output = root.appendingPathComponent(".openclaw/tmp/issue-187607/menu-proof", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let phase = try String(contentsOf: root.appendingPathComponent(".openclaw/tmp/issue-187607/proof-phase.txt"), encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        try #require(["before", "after"].contains(phase))
        let fixture = try await PreferenceProofGateway.start(output: output, phase: phase)
        let endpoint = fixture.url
        let gateway = GatewayConnection(testEndpointProvider: {
            GatewayConnection.EndpointSnapshot(config: (endpoint, nil, nil), routeAuthority: nil, revision: 1)
        }, currentEndpointRevision: { 1 })
        let control = ControlChannel(gateway: gateway, endpointRevision: { 1 })
        let sessions = StatusMenuSessions(control: control)
        let window = NSWindow(contentRect: NSRect(x: 120, y: 150, width: 500, height: 240),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "OpenClaw preference proof — synthetic sessions only"
        window.isReleasedWhenClosed = false
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        let item = NSMenuItem()
        do {
            _ = try await control.request(method: "health")
            let scenarios: [(String, [String: String])] = [
                ("inherited", [:]),
                ("explicit", ["thinkingLevel": "high", "verboseLevel": "on"]),
                ("reuse-inherited", [:]),
                ("off", ["thinkingLevel": "off", "verboseLevel": "off"]),
                ("unrepresented", ["thinkingLevel": "xhigh", "verboseLevel": "full"]),
            ]
            var parent: NSMenu?
            var thinking: NSMenu?
            var verbose: NSMenu?
            var observations: [[String: Any]] = []
            for (scenario, values) in scenarios {
                fixture.preferences["proof-target-A"] = values
                await sessions.refresh(force: true)
                let row = try #require(sessions.rows.first { $0.key == "proof-target-A" })
                sessions.configureSessionItem(item, row: row)
                let menu = try #require(item.submenu)
                let menus = try Self.preferences(menu)
                if let parent {
                    #expect(menu === parent)
                    #expect(menus.0 === thinking)
                    #expect(menus.1 === verbose)
                }
                parent = menu
                thinking = menus.0
                verbose = menus.1
                for (name, field, submenu) in [("thinking", "thinkingLevel", menus.0), ("verbose", "verboseLevel", menus.1)] {
                    let checked = submenu.items.filter { $0.state == .on }.compactMap {
                        ($0.representedObject as? [String: String])?["value"]
                    }
                    let represented = submenu.items.compactMap { ($0.representedObject as? [String: String])?["value"] }
                    let expected = values[field].flatMap { represented.contains($0) ? [$0] : nil }
                        ?? (phase == "before" ? ["off"] : [])
                    #expect(checked == expected)
                    let label = "\(phase)-\(name)-\(scenario)"
                    try await PreferenceProofTracking(menu: submenu, window: window, output: output, label: label).run()
                    observations.append(["capture": label, "checked": checked, "expected": expected,
                                         "storedA": values, "storedB": fixture.preferences["proof-control-B"] ?? [:],
                                         "agentDefaults": fixture.agentDefaults])
                }
            }
            // Real menu selections through own-process native mouse events, not a direct RPC or target/action call.
            fixture.preferences["proof-target-A"] = [:]
            await sessions.refresh(force: true)
            sessions.configureSessionItem(item, row: try #require(sessions.rows.first { $0.key == "proof-target-A" }))
            let controlsBefore = fixture.preferences["proof-control-B"]
            for (field, value, identifier) in [
                ("thinkingLevel", "off", "session.thinking"),
                ("thinkingLevel", "high", "session.thinking"),
                ("verboseLevel", "off", "session.verbose"),
                ("verboseLevel", "on", "session.verbose"),
            ] {
                let before = fixture.preferences["proof-target-A"] ?? [:]
                let count = fixture.patches.count
                let submenu = try #require(item.submenu?.items.first { $0.identifier?.rawValue == identifier }?.submenu)
                let selected = try #require(submenu.items.first {
                    ($0.representedObject as? [String: String])?["value"] == value
                })
                let label = "\(phase)-click-\(field)-\(value)"
                try await PreferenceProofTracking(menu: submenu, window: window, output: output,
                                                  label: label, selection: selected).run()
                try await TestWait.state(label) {
                    fixture.patches.count == count + 1 &&
                        sessions.rows.first { $0.key == "proof-target-A" }.map {
                            field == "thinkingLevel" ? $0.thinkingLevel == value : $0.verboseLevel == value
                        } == true
                }
                let patch = try #require(fixture.patches.last)
                #expect(patch["key"] as? String == "proof-target-A")
                #expect(patch[field] as? String == value)
                #expect(Set(patch.keys) == Set(["key", field]))
                var expected = before
                expected[field] = value
                #expect(fixture.preferences["proof-target-A"] == expected)
                #expect(fixture.preferences["proof-control-B"] == controlsBefore)
                sessions.configureSessionItem(item, row: try #require(sessions.rows.first { $0.key == "proof-target-A" }))
                let refreshedSubmenu = try #require(item.submenu?.items.first {
                    $0.identifier?.rawValue == identifier
                }?.submenu)
                #expect(refreshedSubmenu === submenu)
                let checkedAfterReadback = refreshedSubmenu.items.filter { $0.state == .on }.compactMap {
                    ($0.representedObject as? [String: String])?["value"]
                }
                #expect(checkedAfterReadback == [value])
                observations.append(["selection": label, "request": patch, "checkedAfterReadback": checkedAfterReadback,
                                     "storedA": fixture.preferences["proof-target-A"] ?? [:],
                                     "storedB": fixture.preferences["proof-control-B"] ?? [:]])
                try await PreferenceProofTracking(menu: refreshedSubmenu, window: window, output: output,
                                                  label: "\(label)-readback").run()
            }
            try JSONSerialization.data(withJSONObject: ["phase": phase, "observations": observations,
                                                        "requests": fixture.requests], options: [.prettyPrinted, .sortedKeys])
                .write(to: output.appendingPathComponent("\(phase)-receipts.json"))
            await control.disconnect()
            await gateway.shutdown()
        } catch {
            await control.disconnect()
            await gateway.shutdown()
            fixture.stop()
            window.close()
            throw error
        }
        fixture.stop()
        sessions.cancelPreviewTasks()
        item.view = nil
        item.submenu = nil
        window.close()
    }

    private static func preferences(_ menu: NSMenu) throws -> (NSMenu, NSMenu) {
        (try #require(menu.items.first { $0.identifier?.rawValue == "session.thinking" }?.submenu),
         try #require(menu.items.first { $0.identifier?.rawValue == "session.verbose" }?.submenu))
    }
}

@MainActor
private final class PreferenceProofTracking: NSObject {
    let menu: NSMenu
    let window: NSWindow
    let output: URL
    let label: String
    let selection: NSMenuItem?
    private var inspection: Timer?
    private var deadline: Timer?
    private var continuation: CheckedContinuation<Void, Error>?
    private var failure: Error?
    private var observed = false

    init(menu: NSMenu, window: NSWindow, output: URL, label: String, selection: NSMenuItem? = nil) {
        self.menu = menu
        self.window = window
        self.output = output
        self.label = label
        self.selection = selection
    }

    func run() async throws {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            RunLoop.main.perform(inModes: [.common]) {
                MainActor.assumeIsolated {
                    let inspection = Timer(timeInterval: 0.2, target: self, selector: #selector(self.inspect), userInfo: nil, repeats: true)
                    let deadline = Timer(timeInterval: 10, target: self, selector: #selector(self.timedOut), userInfo: nil, repeats: false)
                    self.inspection = inspection
                    self.deadline = deadline
                    for mode in [RunLoop.Mode.common, .eventTracking] {
                        RunLoop.main.add(inspection, forMode: mode)
                        RunLoop.main.add(deadline, forMode: mode)
                    }
                    let selected = self.menu.popUp(positioning: nil, at: NSPoint(x: 30, y: 140), in: self.window.contentView)
                    self.inspection?.invalidate()
                    self.deadline?.invalidate()
                    if let failure = self.failure {
                        self.continuation?.resume(throwing: failure)
                    } else if !self.observed || (self.selection != nil && !selected) {
                        self.continuation?.resume(throwing: ProofError.failed("Native menu did not track/accept actual mouse selection: \(self.label)"))
                    } else {
                        self.continuation?.resume()
                    }
                    self.continuation = nil
                }
            }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
    }

    @objc private func timedOut() {
        self.failure = ProofError.failed("Native menu timed out: \(self.label)")
        self.menu.cancelTracking()
    }

    @objc private func inspect() {
        guard !self.observed else { return }
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0) as? [[String: Any]],
              !windows.isEmpty else { return }
        let popups = windows.filter {
            $0[kCGWindowOwnerPID as String] as? Int32 == ProcessInfo.processInfo.processIdentifier &&
                $0[kCGWindowLayer as String] as? Int == NSWindow.Level.popUpMenu.rawValue
        }
        guard !popups.isEmpty else { return }
        do {
            guard popups.count == 1, let number = popups[0][kCGWindowNumber as String] as? UInt32 else {
                throw ProofError.failed("Cannot uniquely identify tracked native preference popup")
            }
            let capture = Process()
            capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            capture.arguments = ["-x", "-o", "-l", String(number), self.output.appendingPathComponent("\(self.label).png").path]
            try capture.run()
            capture.waitUntilExit()
            guard capture.terminationStatus == 0 else { throw ProofError.failed("Actual native-menu screenshot failed: \(self.label)") }
            self.observed = true
            if let selection {
                let element = selection as AnyObject
                guard let frame = element.accessibilityFrame?(), !frame.isEmpty,
                      let menuWindow = NSApp.window(withWindowNumber: Int(number)) else {
                    throw ProofError.failed("Selected menu item has no owned native window/frame")
                }
                let point = menuWindow.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
                let eventTypes: [NSEvent.EventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp]
                let events = try eventTypes.enumerated().map { index, type in
                    try #require(NSEvent.mouseEvent(
                        with: type, location: point, modifierFlags: [],
                        timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: menuWindow.windowNumber, context: nil,
                        eventNumber: index + 1, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1))
                }
                try JSONSerialization.data(withJSONObject: [
                    "method": "NSApplication.postEvent -> native NSMenu event tracking",
                    "windowNumber": menuWindow.windowNumber,
                    "screenPoint": ["x": frame.midX, "y": frame.midY],
                    "windowPoint": ["x": point.x, "y": point.y],
                    "item": selection.title,
                ], options: [.prettyPrinted, .sortedKeys])
                    .write(to: self.output.appendingPathComponent("\(self.label)-click.json"))
                // Post only to our AppKit process; no system-wide event injection or AX grant.
                // AppKit's real tracking loop chooses the menu item and dispatches production action.
                for event in events { NSApp.postEvent(event, atStart: false) }
            } else {
                self.menu.cancelTracking()
            }
        } catch {
            self.failure = error
            self.menu.cancelTracking()
        }
    }
}

private enum ProofError: Error {
    case failed(String)
}

@MainActor
private final class PreferenceProofGateway {
    private let listener: NWListener
    private let output: URL
    private let phase: String
    private var connections: [NWConnection] = []
    private let changes = AsyncTestSignal()
    private(set) var requests: [[String: Any]] = []
    private(set) var patches: [[String: Any]] = []
    let agentDefaults = ["thinkingLevel": "high", "verboseLevel": "on"]
    var preferences: [String: [String: String]] = [
        "proof-target-A": [:], "proof-control-B": ["thinkingLevel": "high", "verboseLevel": "on"],
    ]

    private init(listener: NWListener, output: URL, phase: String) {
        self.listener = listener
        self.output = output
        self.phase = phase
        listener.stateUpdateHandler = { [weak self] _ in MainActor.assumeIsolated { self?.changes.notify() } }
        listener.newConnectionHandler = { [weak self] connection in MainActor.assumeIsolated { self?.accept(connection) } }
    }

    static func start(output: URL, phase: String) async throws -> PreferenceProofGateway {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        let fixture = try PreferenceProofGateway(listener: NWListener(using: parameters, on: .any), output: output, phase: phase)
        fixture.listener.start(queue: .main)
        try await fixture.changes.wait("preference proof loopback listener") {
            switch fixture.listener.state {
            case .ready, .failed, .cancelled: true
            default: false
            }
        }
        guard case .ready = fixture.listener.state else { throw URLError(.cannotConnectToHost) }
        return fixture
    }

    var url: URL { URL(string: "ws://127.0.0.1:\(self.listener.port!.rawValue)")! }

    func stop() {
        self.listener.cancel()
        self.connections.forEach { $0.cancel() }
    }

    private func accept(_ connection: NWConnection) {
        self.connections.append(connection)
        connection.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                guard let self, case .ready = state else { return }
                self.send(GatewayWebSocketTestSupport.connectChallengeData(), on: connection)
                self.receive(connection)
            }
        }
        connection.start(queue: .main)
    }

    private func receive(_ connection: NWConnection) {
        connection.receiveMessage { [weak self] data, context, _, error in
            MainActor.assumeIsolated {
                guard let self else { return }
                let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
                guard error == nil, metadata?.opcode != .close, context?.isFinal != true else {
                    connection.cancel()
                    return
                }
                if let data {
                    do {
                        guard let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let id = frame["id"] as? String, let method = frame["method"] as? String else {
                            throw ProofError.failed("Invalid fixture frame")
                        }
                        self.requests.append(frame)
                        if method == "connect" {
                            self.send(GatewayWebSocketTestSupport.connectOkData(id: id), on: connection)
                        } else {
                            let payload: [String: Any]
                            switch method {
                            case "sessions.list":
                                let rows = self.preferences.keys.sorted().map { key -> [String: String] in
                                    var row = self.preferences[key] ?? [:]
                                    row["key"] = key
                                    row["displayName"] = key
                                    row["kind"] = "direct"
                                    row["effectiveThinkingLevel"] = row["thinkingLevel"] ?? self.agentDefaults["thinkingLevel"]
                                    return row
                                }
                                payload = ["path": "/synthetic/preference-proof/sessions.json", "sessions": rows,
                                           "defaults": self.agentDefaults]
                            case "sessions.patch":
                                let params = try #require(frame["params"] as? [String: Any])
                                let key = try #require(params["key"] as? String)
                                try #require(self.preferences[key] != nil)
                                self.patches.append(params)
                                for field in ["thinkingLevel", "verboseLevel"] {
                                    if let value = params[field] as? String { self.preferences[key, default: [:]][field] = value }
                                }
                                payload = ["ok": true, "key": key, "entry": self.preferences[key] ?? [:]]
                            case "sessions.preview": payload = ["ts": 1_800_000_000_000, "previews": []]
                            default: payload = ["ok": true]
                            }
                            self.send(try JSONSerialization.data(withJSONObject: ["type": "res", "id": id,
                                                                                   "ok": true, "payload": payload]), on: connection)
                        }
                    } catch {
                        Issue.record("Preference fixture failure: \(error)")
                        connection.cancel()
                    }
                }
                do {
                    try JSONSerialization.data(withJSONObject: ["requests": self.requests, "patches": self.patches,
                                                                "stored": self.preferences, "agentDefaults": self.agentDefaults],
                                               options: [.prettyPrinted, .sortedKeys])
                        .write(to: self.output.appendingPathComponent("\(self.phase)-wire-progress.json"), options: .atomic)
                } catch {
                    Issue.record("Cannot preserve loopback receipts: \(error)")
                }
                self.receive(connection)
            }
        }
    }

    private func send(_ data: Data, on connection: NWConnection) {
        let context = NWConnection.ContentContext(identifier: "preference-proof-frame",
                                                   metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
    }
}
