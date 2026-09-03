import Foundation
import OpenClawKit
import Synchronization
import Testing
@testable import OpenClaw

@Suite(.serialized)
@MainActor
struct ConfigStoreTests {
    @Test func `load uses remote in remote mode`() async {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { true },
            loadLocal: { localHit = true
                return ["local": true]
            },
            loadRemote: { remoteHit = true
                return ["remote": true]
            }))

        let result = await ConfigStore.load()

        await ConfigStore._testClearOverrides()
        #expect(remoteHit)
        #expect(!localHit)
        #expect(result["remote"] as? Bool == true)
    }

    @Test func `load uses local in local mode`() async {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { false },
            loadLocal: { localHit = true
                return ["local": true]
            },
            loadRemote: { remoteHit = true
                return ["remote": true]
            }))

        let result = await ConfigStore.load()

        await ConfigStore._testClearOverrides()
        #expect(localHit)
        #expect(!remoteHit)
        #expect(result["local"] as? Bool == true)
    }

    @Test func `save routes to remote in remote mode`() async throws {
        var localHit = false
        var remoteHit = false
        let notificationCenter = NotificationCenter()
        let changeCount = NotificationCount()
        let observer = notificationCenter.addObserver(
            forName: .openclawConfigDidChange,
            object: nil,
            queue: nil)
        { note in changeCount.record(note) }
        defer { notificationCenter.removeObserver(observer) }

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            saveLocal: { _ in localHit = true },
            saveRemote: { _ in
                remoteHit = true
                // Reproduce a concurrent AppState-style publisher overlapping this save.
                await Task.detached {
                    NotificationCenter.default.post(name: .openclawConfigDidChange, object: nil)
                }.value
            },
            notificationCenter: notificationCenter))
        {
            try await ConfigStore.save(["remote": true], source: .gateway(baseHash: "revision-1", route: nil))
        }

        #expect(remoteHit)
        #expect(!localHit)
        #expect(changeCount.value == 1)
        #expect(changeCount.allSendersWereNil)
    }

    @Test func `save routes to local in local mode`() async throws {
        var localHit = false
        var remoteHit = false
        await ConfigStore._testSetOverrides(.init(
            isRemoteMode: { false },
            saveLocal: { _ in localHit = true },
            saveRemote: { _ in remoteHit = true }))

        try await ConfigStore.save(["local": true], source: .local)

        await ConfigStore._testClearOverrides()
        #expect(localHit)
        #expect(!remoteHit)
    }

    @Test func `failed save does not announce config change`() async {
        let notificationCenter = NotificationCenter()
        let changeCount = NotificationCount()
        let observer = notificationCenter.addObserver(
            forName: .openclawConfigDidChange,
            object: nil,
            queue: nil)
        { note in changeCount.record(note) }
        defer { notificationCenter.removeObserver(observer) }

        await self.withOverrides(.init(
            isRemoteMode: { true },
            saveRemote: { _ in
                // Concurrent same-name traffic must not look like a ConfigStore announcement.
                await Task.detached {
                    NotificationCenter.default.post(name: .openclawConfigDidChange, object: nil)
                }.value
                throw NSError(domain: "ConfigStoreTests", code: 1)
            },
            notificationCenter: notificationCenter))
        {
            do {
                try await ConfigStore.save(["remote": true], source: .gateway(baseHash: "revision-1", route: nil))
                Issue.record("Expected save to fail")
            } catch {}
        }

        #expect(changeCount.value == 0)
    }

    @Test func `browser update patches only its field and retries a stale revision`() async throws {
        var revisions = ["revision-1", "revision-2"]
        var patches: [([String: Any], String?)] = []

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: { (true, revisions.removeFirst(), true, nil) },
            writeGateway: { method, patch, baseHash in
                #expect(method == "config.patch")
                patches.append((patch, baseHash))
                if patches.count == 1 {
                    throw NSError(domain: "Gateway", code: 0, userInfo: [
                        NSLocalizedDescriptionKey: "config changed since last load; re-run config.get and retry",
                    ])
                }
                return "revision-3"
            })) {
                try await ConfigStore.setBrowserEnabled(false)
            }

        #expect(revisions.isEmpty)
        #expect(patches.map(\.1) == ["revision-1", "revision-2"])
        #expect(patches.allSatisfy {
            let browser = $0.0["browser"] as? [String: Any]
            return $0.0.count == 1 && browser?.count == 1 && browser?["enabled"] as? Bool == false
        })
    }

    @Test func `full-root save uses the revision loaded with that root after a browser patch`() async throws {
        var writes: [(String, String?)] = []
        let channels = ChannelsStore(isPreview: true)
        channels.configSourceKey = "gateway"
        let previousAccent = AppStateStore.shared.seamColorHex
        defer { AppStateStore.shared.seamColorHex = previousAccent }

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: { (true, "revision-1", true, ["browser": ["enabled": true]]) },
            writeGateway: { method, _, baseHash in
                writes.append((method, baseHash))
                return method == "config.patch" ? "revision-2" : "revision-3"
            })) {
                try await ConfigStore.setBrowserEnabled(false)
                channels.applyConfigSnapshot(
                    ConfigSnapshot(
                        path: nil,
                        exists: true,
                        raw: nil,
                        hash: "revision-2",
                        parsed: nil,
                        valid: true,
                        config: [
                            "browser": AnyCodable(["enabled": false]),
                            "channels": AnyCodable(["discord": ["enabled": true]]),
                        ],
                        issues: nil),
                    sourceKey: "gateway",
                    force: true,
                    saveSource: .gateway(baseHash: "revision-2", route: nil))
                guard let source = channels.configSaveSource else {
                    Issue.record("Expected Channels to retain its loaded revision")
                    return
                }
                try await ConfigStore.save(channels.configDraft, source: source)
            }

        #expect(writes.map(\.0) == ["config.patch", "config.set"])
        #expect(writes.map(\.1) == ["revision-1", "revision-2"])
    }

    @Test func `channels cannot save an incomplete existing snapshot`() {
        let channels = ChannelsStore(isPreview: true)
        channels.configSourceKey = "gateway"

        channels.applyConfigSnapshot(
            ConfigSnapshot(
                path: nil,
                exists: true,
                raw: nil,
                hash: "revision-1",
                parsed: nil,
                valid: true,
                config: nil,
                issues: nil),
            sourceKey: "gateway",
            force: true,
            saveSource: .gateway(baseHash: "revision-1", route: nil))

        #expect(channels.configSaveSource == nil)
    }

    @Test func `mutation load carries its gateway revision with the complete root`() async throws {
        let loaded = try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: {
                (true, "revision-7", true, ["unrelated": "kept"])
            })) {
                try await ConfigStore.loadForMutation()
            }

        #expect(loaded.root["unrelated"] as? String == "kept")
        guard case let .gateway(baseHash, _) = loaded.source else {
            Issue.record("Expected a Gateway mutation source")
            return
        }
        #expect(baseHash == "revision-7")
    }

    @Test func `failed remote mutation load produces no writable root`() async {
        var didThrow = false
        _ = await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: {
                throw NSError(domain: "Gateway", code: 0, userInfo: [
                    NSLocalizedDescriptionKey: "gateway unavailable",
                ])
            })) {
                do {
                    _ = try await ConfigStore.loadForMutation()
                    Issue.record("Expected mutation load to fail")
                } catch {
                    didThrow = true
                }
            }
        #expect(didThrow)
    }

    @Test func `local mutation load does not fall back after a protocol failure`() async {
        var attemptedLocalWrite = false

        _ = await self.withOverrides(.init(
            isRemoteMode: { false },
            saveLocal: { _ in attemptedLocalWrite = true },
            loadGatewayRevision: {
                throw GatewayDecodingError(method: "config.get", message: "invalid snapshot")
            })) {
                await #expect(throws: GatewayDecodingError.self) {
                    _ = try await ConfigStore.loadForMutation()
                }
            }

        #expect(!attemptedLocalWrite)
    }

    @Test func `browser update preserves a fresh full root when config patch is unavailable`() async throws {
        var revisions = [
            ("revision-1", ["unrelated": "first", "browser": ["other": "old"]] as [String: Any]),
            ("revision-2", ["unrelated": "second", "browser": ["other": "kept"]] as [String: Any]),
        ]
        var writtenRoot: [String: Any]?
        var writes = 0

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: {
                let revision = revisions.removeFirst()
                return (true, revision.0, true, revision.1)
            },
            supportsGatewayMethod: { method in
                #expect(method == "config.patch")
                return false
            },
            writeGateway: { method, root, baseHash in
                #expect(method == "config.set")
                writes += 1
                writtenRoot = root
                if writes == 1 {
                    #expect(baseHash == "revision-1")
                    throw NSError(domain: "Gateway", code: 0, userInfo: [
                        NSLocalizedDescriptionKey: "config changed since last load; re-run config.get and retry",
                    ])
                }
                #expect(baseHash == "revision-2")
                return "revision-2"
            })) {
                try await ConfigStore.setBrowserEnabled(false)
            }

        #expect(revisions.isEmpty)
        #expect(writes == 2)
        let browser = writtenRoot?["browser"] as? [String: Any]
        #expect(writtenRoot?["unrelated"] as? String == "second")
        #expect(browser?["other"] as? String == "kept")
        #expect(browser?["enabled"] as? Bool == false)
    }

    @Test func `browser update falls back after a definitive unsupported patch response`() async throws {
        var revisions = [
            ("revision-1", ["unrelated": "first"] as [String: Any]),
            ("revision-2", ["unrelated": "kept", "browser": ["other": "kept"]] as [String: Any]),
        ]
        var writes: [(String, [String: Any], String?)] = []

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: {
                let revision = revisions.removeFirst()
                return (true, revision.0, true, revision.1)
            },
            supportsGatewayMethod: { _ in nil },
            writeGateway: { method, root, baseHash in
                writes.append((method, root, baseHash))
                if method == "config.patch" {
                    throw GatewayResponseError(
                        method: method,
                        code: "INVALID_REQUEST",
                        message: "unknown method: config.patch",
                        details: nil)
                }
                return "revision-3"
            })) {
                try await ConfigStore.setBrowserEnabled(false)
            }

        #expect(revisions.isEmpty)
        #expect(writes.map(\.0) == ["config.patch", "config.set"])
        #expect(writes.map(\.2) == ["revision-1", "revision-2"])
        let browser = writes.last?.1["browser"] as? [String: Any]
        #expect(writes.last?.1["unrelated"] as? String == "kept")
        #expect(browser?["other"] as? String == "kept")
        #expect(browser?["enabled"] as? Bool == false)
    }

    @Test func `browser update refuses incomplete full roots without config patch`() async {
        let incompleteSnapshots: [(Bool?, [String: Any]?)] = [
            (false, [:]),
            (true, nil),
        ]

        for snapshot in incompleteSnapshots {
            var attemptedWrite = false
            _ = await self.withOverrides(.init(
                isRemoteMode: { true },
                loadGatewayRevision: { (true, "revision-1", snapshot.0, snapshot.1) },
                supportsGatewayMethod: { _ in false },
                writeGateway: { _, _, _ in
                    attemptedWrite = true
                    return nil
                })) {
                    await #expect(throws: NSError.self) {
                        try await ConfigStore.setBrowserEnabled(false)
                    }
                }
            #expect(!attemptedWrite)
        }
    }

    @Test func `failed remote browser read cannot fall back after a mode switch`() async {
        let remoteModes = Mutex([true, true, false])
        var attemptedWrite = false
        var attemptedLocalWrite = false

        _ = await self.withOverrides(.init(
            isRemoteMode: { remoteModes.withLock { $0.removeFirst() } },
            saveLocal: { _ in attemptedLocalWrite = true },
            loadGatewayRevision: {
                throw CancellationError()
            },
            writeGateway: { _, _, _ in
                attemptedWrite = true
                return nil
            })) {
                await #expect(throws: NSError.self) {
                    try await ConfigStore.setBrowserEnabled(false)
                }
            }

        #expect(!attemptedWrite)
        #expect(!attemptedLocalWrite)
    }

    @Test func `route-cancelled local browser update cannot fall back to disk`() async {
        var attemptedLocalWrite = false

        _ = await self.withOverrides(.init(
            isRemoteMode: { false },
            saveLocal: { _ in attemptedLocalWrite = true },
            loadGatewayRevision: {
                throw CancellationError()
            },
            writeGateway: { _, _, _ in nil }))
        {
            await #expect(throws: CancellationError.self) {
                try await ConfigStore.setBrowserEnabled(false)
            }
        }

        #expect(!attemptedLocalWrite)
    }

    @Test func `post-dispatch route change cannot fall back to disk`() async {
        var attemptedLocalWrite = false

        _ = await self.withOverrides(.init(
            isRemoteMode: { false },
            saveLocal: { _ in attemptedLocalWrite = true },
            loadGatewayRevision: {
                throw GatewayRouteChangedAfterDispatchError(method: "config.get")
            },
            writeGateway: { _, _, _ in nil }))
        {
            await #expect(throws: GatewayRouteChangedAfterDispatchError.self) {
                try await ConfigStore.setBrowserEnabled(false)
            }
        }

        #expect(!attemptedLocalWrite)
    }

    @Test func `invalid local gateway snapshots cannot fall back to disk`() async {
        let snapshots: [(Bool, String?, Bool?, [String: Any]?)] = [
            (true, nil, true, [:]),
            (true, "revision-1", false, [:]),
            (true, "revision-1", true, nil),
        ]

        for snapshot in snapshots {
            var attemptedGatewayWrite = false
            var attemptedLocalWrite = false
            _ = await self.withOverrides(.init(
                isRemoteMode: { false },
                saveLocal: { _ in attemptedLocalWrite = true },
                loadGatewayRevision: { snapshot },
                supportsGatewayMethod: { _ in false },
                writeGateway: { _, _, _ in
                    attemptedGatewayWrite = true
                    return nil
                })) {
                    await #expect(throws: NSError.self) {
                        try await ConfigStore.setBrowserEnabled(false)
                    }
                }

            #expect(!attemptedGatewayWrite)
            #expect(!attemptedLocalWrite)
        }
    }

    @Test func `browser update stops when connection mode changes before its read`() async {
        let remoteModes = Mutex([true, false, false])
        var attemptedRead = false
        var attemptedWrite = false

        _ = await self.withOverrides(.init(
            isRemoteMode: { remoteModes.withLock { $0.removeFirst() } },
            loadGatewayRevision: {
                attemptedRead = true
                return (true, "revision-1", true, [:])
            },
            writeGateway: { _, _, _ in
                attemptedWrite = true
                return nil
            })) {
                await #expect(throws: NSError.self) {
                    try await ConfigStore.setBrowserEnabled(false)
                }
            }

        #expect(!attemptedRead)
        #expect(!attemptedWrite)
    }

    @Test func `browser update creates only browser config when no config exists`() async throws {
        var created: [String: Any]?

        try await self.withOverrides(.init(
            isRemoteMode: { true },
            loadGatewayRevision: { (false, nil, nil, nil) },
            writeGateway: { method, root, baseHash in
                #expect(method == "config.set")
                #expect(baseHash == nil)
                created = root
                return "created-revision"
            })) {
                try await ConfigStore.setBrowserEnabled(false)
            }

        let browser = created?["browser"] as? [String: Any]
        #expect(created?.count == 1)
        #expect(browser?.count == 1)
        #expect(browser?["enabled"] as? Bool == false)
    }

    @Test func `local browser update falls back to a field-only file write`() async throws {
        var writtenRoot: [String: Any]?

        try await self.withOverrides(.init(
            isRemoteMode: { false },
            loadLocal: { ["unrelated": true, "browser": ["other": "kept"]] },
            saveLocal: { writtenRoot = $0 },
            loadGatewayRevision: {
                throw NSError(domain: "Gateway", code: 0, userInfo: [
                    NSLocalizedDescriptionKey: "gateway not configured",
                ])
            },
            writeGateway: { _, _, _ in
                Issue.record("Unexpected gateway write")
                return nil
            })) {
                try await ConfigStore.setBrowserEnabled(false)
            }

        let browser = writtenRoot?["browser"] as? [String: Any]
        #expect(writtenRoot?["unrelated"] as? Bool == true)
        #expect(browser?["other"] as? String == "kept")
        #expect(browser?["enabled"] as? Bool == false)
    }

    @Test func `local save does not fall back to direct write after stale gateway rejection`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("openclaw-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("openclaw.json")
        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "OPENCLAW_STATE_DIR": stateDir.path,
            "OPENCLAW_CONFIG_PATH": configPath.path,
        ]) {
            OpenClawConfigFile.saveDict([
                "gateway": [
                    "mode": "local",
                    "auth": [
                        "mode": "token",
                        "token": "test-token", // pragma: allowlist secret
                    ],
                ],
            ])
            let before = try String(contentsOf: configPath, encoding: .utf8)
            await ConfigStore._testSetOverrides(.init(
                isRemoteMode: { false },
                saveGateway: { _ in
                    throw NSError(domain: "Gateway", code: 0, userInfo: [
                        NSLocalizedDescriptionKey: "config changed since last load; re-run config.get and retry",
                    ])
                }))

            var didThrow = false
            do {
                try await ConfigStore.save(
                    ["browser": ["enabled": false]],
                    source: .gateway(baseHash: "revision-1", route: nil))
            } catch {
                didThrow = true
            }
            await ConfigStore._testClearOverrides()

            #expect(didThrow)
            let after = try String(contentsOf: configPath, encoding: .utf8)
            #expect(after == before)
        }
    }

    @Test func `local mutation load falls back before dispatch when gateway is unavailable`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("openclaw-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("openclaw.json")
        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "OPENCLAW_STATE_DIR": stateDir.path,
            "OPENCLAW_CONFIG_PATH": configPath.path,
        ]) {
            await ConfigStore._testSetOverrides(.init(
                isRemoteMode: { false },
                loadGatewayRevision: {
                    throw NSError(domain: "GatewayEndpoint", code: 1, userInfo: [
                        NSLocalizedDescriptionKey: "gateway not configured",
                    ])
                }))
            let loaded = try await ConfigStore.loadForMutation()
            try await ConfigStore.save(
                [
                    "gateway": ["mode": "local"],
                    "browser": ["enabled": false],
                ],
                source: loaded.source)
            await ConfigStore._testClearOverrides()

            let data = try Data(contentsOf: configPath)
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            #expect(((root?["browser"] as? [String: Any])?["enabled"] as? Bool) == false)
            #expect((root?["meta"] as? [String: Any]) != nil)
        }
    }

    private func withOverrides<T>(
        _ overrides: ConfigStore.Overrides,
        _ body: () async throws -> T) async rethrows -> T
    {
        await ConfigStore._testSetOverrides(overrides)
        do {
            let result = try await body()
            await ConfigStore._testClearOverrides()
            return result
        } catch {
            await ConfigStore._testClearOverrides()
            throw error
        }
    }
}

private final class NotificationCount: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var sawNonNilSender = false

    var value: Int {
        self.lock.withLock { self.count }
    }

    var allSendersWereNil: Bool {
        self.lock.withLock { !self.sawNonNilSender }
    }

    func record(_ notification: Notification) {
        self.lock.withLock {
            self.count += 1
            self.sawNonNilSender = self.sawNonNilSender || notification.object != nil
        }
    }
}
