import Foundation
import OpenClawKit
import OpenClawProtocol

enum ConfigStore {
    enum SaveSource {
        // The route is nil only when tests inject the transport; production writes require one.
        case gateway(baseHash: String?, route: GatewayConnection.Route?)
        case local
    }

    struct LoadedConfig {
        let root: [String: Any]
        let source: SaveSource
    }

    private struct ConfigWriteAck: Decodable {
        let hash: String?
    }

    struct Overrides {
        var isRemoteMode: (@Sendable () async -> Bool)?
        var loadLocal: (@MainActor @Sendable () -> [String: Any])?
        var saveLocal: (@MainActor @Sendable ([String: Any]) -> Void)?
        var loadRemote: (@MainActor @Sendable () async -> [String: Any])?
        var saveRemote: (@MainActor @Sendable ([String: Any]) async throws -> Void)?
        var saveGateway: (@MainActor @Sendable ([String: Any]) async throws -> Void)?
        var loadGatewayRevision: (@MainActor @Sendable () async throws -> (
            exists: Bool,
            hash: String?,
            valid: Bool?,
            root: [String: Any]?))?
        var loadGatewayBrowserEnabled: (@MainActor @Sendable () async throws -> Bool)?
        var supportsGatewayMethod: (@MainActor @Sendable (String) -> Bool?)?
        var writeGateway: (@MainActor @Sendable (String, [String: Any], String?) async throws -> String?)?
        #if DEBUG
        /// Isolates focused notification assertions without changing the production sender contract.
        var notificationCenter: NotificationCenter?
        #endif
    }

    private actor OverrideStore {
        var overrides = Overrides()

        func setOverride(_ overrides: Overrides) {
            self.overrides = overrides
        }
    }

    private static let overrideStore = OverrideStore()
    private static func isRemoteMode() async -> Bool {
        let overrides = await self.overrideStore.overrides
        if let override = overrides.isRemoteMode {
            return await override()
        }
        return await MainActor.run { AppStateStore.shared.connectionMode == .remote }
    }

    @MainActor
    static func load() async -> [String: Any] {
        let overrides = await self.overrideStore.overrides
        if await self.isRemoteMode() {
            if let override = overrides.loadRemote {
                return await override()
            }
            return await (try? self.loadFromGateway())?.root ?? [:]
        }
        if let override = overrides.loadLocal {
            return override()
        }
        if let gateway = try? await self.loadFromGateway() {
            return gateway.root
        }
        return OpenClawConfigFile.loadDict()
    }

    @MainActor
    static func loadForMutation() async throws -> LoadedConfig {
        let overrides = await self.overrideStore.overrides
        if await self.isRemoteMode() {
            return try await self.loadFromGateway(overrides: overrides)
        }
        if let override = overrides.loadLocal {
            return LoadedConfig(root: override(), source: .local)
        }
        do {
            return try await self.loadFromGateway(overrides: overrides)
        } catch is GatewayUnavailableBeforeConfigDispatchError {
            return LoadedConfig(root: OpenClawConfigFile.loadDict(), source: .local)
        }
    }

    @MainActor
    static func save(
        _ root: sending [String: Any],
        source: SaveSource,
        allowGatewayAuthMutation: Bool = false) async throws
    {
        let overrides = await self.overrideStore.overrides
        if await self.isRemoteMode() {
            guard case let .gateway(baseHash, route) = source else {
                throw NSError(domain: "ConfigStore", code: 6, userInfo: [
                    NSLocalizedDescriptionKey: "Gateway config must be loaded before saving it.",
                ])
            }
            do {
                if let override = overrides.saveRemote {
                    try await override(root)
                } else {
                    try await self.saveToGateway(
                        root,
                        baseHash: baseHash,
                        ifCurrentRoute: route)
                }
            } catch {
                throw error
            }
        } else {
            switch source {
            case let .gateway(baseHash, route):
                try await self.saveToGateway(root, baseHash: baseHash, ifCurrentRoute: route)
            case .local:
                try self.saveLocally(
                    root,
                    overrides: overrides,
                    allowGatewayAuthMutation: allowGatewayAuthMutation)
            }
        }
        self.postChangeNotification(overrides: overrides)
    }

    @MainActor
    static func setBrowserEnabled(_ enabled: Bool) async throws {
        let overrides = await self.overrideStore.overrides
        let startedRemote = await self.isRemoteMode()
        do {
            let route: GatewayConnection.Route? = if overrides.loadGatewayRevision != nil,
                                                     overrides.writeGateway != nil
            {
                nil
            } else {
                try await GatewayConnection.shared.captureRequiredRoute()
            }
            try await self.requireConnectionMode(startedRemote)
            var retriesRemaining = 1
            while true {
                do {
                    let revision = try await self.loadGatewayRevision(overrides: overrides, ifCurrentRoute: route)
                    let patch = ["browser": ["enabled": enabled]]
                    let root: [String: Any]
                    let method: GatewayConnection.Method
                    let baseHash: String?
                    let supportsPatch: Bool?
                    if revision.exists {
                        guard let revisionHash = revision.hash?.nonEmpty else {
                            throw NSError(domain: "ConfigStore", code: 3, userInfo: [
                                NSLocalizedDescriptionKey: "Gateway config read did not return a revision.",
                            ])
                        }
                        supportsPatch = await self.supportsGatewayMethod(
                            .configPatch,
                            overrides: overrides,
                            route: route)
                        if supportsPatch == false {
                            guard revision.valid != false, var completeRoot = revision.root else {
                                throw NSError(domain: "ConfigStore", code: 4, userInfo: [
                                    NSLocalizedDescriptionKey: "Gateway config read did not return " +
                                        "a valid complete config.",
                                ])
                            }
                            var browser = completeRoot["browser"] as? [String: Any] ?? [:]
                            browser["enabled"] = enabled
                            completeRoot["browser"] = browser
                            root = completeRoot
                            method = .configSet
                        } else {
                            root = patch
                            method = .configPatch
                        }
                        baseHash = revisionHash
                    } else {
                        supportsPatch = nil
                        root = patch
                        method = .configSet
                        baseHash = nil
                    }
                    do {
                        _ = try await self.writeGateway(
                            root,
                            method: method,
                            overrides: overrides,
                            baseHash: baseHash,
                            ifCurrentRoute: route)
                    } catch {
                        guard supportsPatch == nil,
                              method == .configPatch,
                              self.isUnsupportedConfigPatchError(error)
                        else {
                            throw error
                        }
                        let fallback = try await self.loadGatewayRevision(
                            overrides: overrides,
                            ifCurrentRoute: route)
                        guard fallback.exists,
                              let fallbackHash = fallback.hash?.nonEmpty,
                              fallback.valid != false,
                              var completeRoot = fallback.root
                        else {
                            throw error
                        }
                        var browser = completeRoot["browser"] as? [String: Any] ?? [:]
                        browser["enabled"] = enabled
                        completeRoot["browser"] = browser
                        _ = try await self.writeGateway(
                            completeRoot,
                            method: .configSet,
                            overrides: overrides,
                            baseHash: fallbackHash,
                            ifCurrentRoute: route)
                    }
                    // Full-root saves carry their own revision, so this partial patch cannot
                    // authorize a root loaded before or after it.
                    self.postChangeNotification(overrides: overrides)
                    return
                } catch {
                    guard retriesRemaining > 0, self.isStaleConfigWriteError(error) else { throw error }
                    retriesRemaining -= 1
                }
            }
        } catch {
            let currentlyRemote = await self.isRemoteMode()
            guard !startedRemote,
                  !currentlyRemote,
                  self.shouldFallbackBrowserWriteToLocal(afterGatewayError: error)
            else {
                throw error
            }
            try self.saveBrowserLocally(enabled, overrides: overrides)
            self.postChangeNotification(overrides: overrides)
        }
    }

    @MainActor
    static func readBrowserEnabled() async throws -> Bool {
        let overrides = await self.overrideStore.overrides
        if let loadGatewayBrowserEnabled = overrides.loadGatewayBrowserEnabled {
            return try await loadGatewayBrowserEnabled()
        }
        let snapshot: ConfigSnapshot = try await GatewayConnection.shared.requestDecoded(
            method: .configGet,
            params: nil,
            timeoutMs: 8000)
        return snapshot.config?["browser"]?.dictionaryValue?["enabled"]?.boolValue ?? true
    }

    @MainActor
    private static func loadFromGateway(overrides: Overrides? = nil) async throws -> LoadedConfig {
        let snapshot: ConfigSnapshot
        let source: SaveSource
        if let loadGatewayRevision = overrides?.loadGatewayRevision {
            let revision: (exists: Bool, hash: String?, valid: Bool?, root: [String: Any]?)
            do {
                revision = try await loadGatewayRevision()
            } catch {
                guard self.shouldAllowLocalMutationFallback(afterPreDispatchError: error) else { throw error }
                throw GatewayUnavailableBeforeConfigDispatchError(underlying: error)
            }
            snapshot = ConfigSnapshot(
                path: nil,
                exists: revision.exists,
                raw: nil,
                hash: revision.hash,
                parsed: nil,
                valid: revision.valid,
                config: revision.root?.mapValues(AnyCodable.init),
                issues: nil)
            source = .gateway(baseHash: revision.hash?.nonEmpty, route: nil)
        } else {
            let route: GatewayConnection.Route
            do {
                route = try await GatewayConnection.shared.captureRequiredRoute()
            } catch {
                guard self.shouldAllowLocalMutationFallback(afterPreDispatchError: error) else { throw error }
                throw GatewayUnavailableBeforeConfigDispatchError(underlying: error)
            }
            snapshot = try await GatewayConnection.shared.requestDecoded(
                method: .configGet,
                params: nil,
                timeoutMs: 8000,
                ifCurrentRoute: route)
            source = .gateway(baseHash: snapshot.hash?.nonEmpty, route: route)
        }
        let exists = snapshot.exists ?? true
        guard !exists || snapshot.hash?.nonEmpty != nil else {
            throw NSError(domain: "ConfigStore", code: 7, userInfo: [
                NSLocalizedDescriptionKey: "Gateway config read did not return a revision.",
            ])
        }
        guard snapshot.valid != false, !exists || snapshot.config != nil else {
            throw NSError(domain: "ConfigStore", code: 8, userInfo: [
                NSLocalizedDescriptionKey: "Gateway config read did not return a valid complete config.",
            ])
        }
        return LoadedConfig(
            root: snapshot.config?.mapValues { $0.foundationValue } ?? [:],
            source: source)
    }

    private struct GatewayUnavailableBeforeConfigDispatchError: LocalizedError {
        let underlying: Error

        var errorDescription: String? {
            self.underlying.localizedDescription
        }
    }

    private static func shouldAllowLocalMutationFallback(afterPreDispatchError error: Error) -> Bool {
        guard !(error is CancellationError),
              !(error is GatewayRouteChangedAfterDispatchError),
              !(error is GatewayResponseError),
              !(error is GatewayDecodingError),
              (error as NSError).domain != "ConfigStore"
        else {
            return false
        }
        if let urlError = error as? URLError {
            return [
                .cannotFindHost,
                .cannotConnectToHost,
                .networkConnectionLost,
                .notConnectedToInternet,
                .timedOut,
                .dnsLookupFailed,
                .resourceUnavailable,
            ].contains(urlError.code)
        }
        let nsError = error as NSError
        return nsError.domain == "GatewayEndpoint" && nsError.code == 1 &&
            self.shouldFallbackToLocalWrite(afterGatewaySaveError: error)
    }

    private static func shouldFallbackToLocalWrite(afterGatewaySaveError error: Error) -> Bool {
        let nsError = error as NSError
        let message = "\(nsError.domain) \(nsError.localizedDescription)".lowercased()
        let blockedFragments = [
            "invalid_request",
            "invalid request",
            "invalid config",
            "config changed since last load",
            "base hash",
            "basehash",
            "unauthorized",
            "token mismatch",
            "auth",
        ]
        return !blockedFragments.contains { message.contains($0) }
    }

    private static func shouldFallbackBrowserWriteToLocal(afterGatewayError error: Error) -> Bool {
        guard !(error is CancellationError),
              !(error is GatewayRouteChangedAfterDispatchError),
              !(error is GatewayResponseError),
              !(error is GatewayDecodingError),
              (error as NSError).domain != "ConfigStore"
        else {
            return false
        }
        return self.shouldFallbackToLocalWrite(afterGatewaySaveError: error)
    }

    private static func isStaleConfigWriteError(_ error: Error) -> Bool {
        let message = (error as NSError).localizedDescription.lowercased()
        return message.contains("config changed since last load") ||
            message.contains("config base hash required")
    }

    private static func isUnsupportedConfigPatchError(_ error: Error) -> Bool {
        guard let response = error as? GatewayResponseError else { return false }
        return response.method == GatewayConnection.Method.configPatch.rawValue &&
            response.code == "INVALID_REQUEST" &&
            response.message == "unknown method: config.patch"
    }

    private static func requireConnectionMode(_ expectedRemote: Bool) async throws {
        guard await self.isRemoteMode() == expectedRemote else {
            throw NSError(domain: "ConfigStore", code: 5, userInfo: [
                NSLocalizedDescriptionKey: "Gateway connection mode changed before the config write.",
            ])
        }
    }

    @MainActor
    private static func loadGatewayRevision(
        overrides: Overrides,
        ifCurrentRoute route: GatewayConnection.Route?) async throws -> (
        exists: Bool,
        hash: String?,
        valid: Bool?,
        root: [String: Any]?)
    {
        if let loadGatewayRevision = overrides.loadGatewayRevision {
            return try await loadGatewayRevision()
        }
        guard let route else { preconditionFailure("Gateway route required") }
        let snapshot: ConfigSnapshot = try await GatewayConnection.shared.requestDecoded(
            method: .configGet,
            params: nil,
            timeoutMs: 8000,
            ifCurrentRoute: route)
        return (
            snapshot.exists ?? true,
            snapshot.hash,
            snapshot.valid,
            snapshot.config?.mapValues { $0.foundationValue })
    }

    @MainActor
    private static func supportsGatewayMethod(
        _ method: GatewayConnection.Method,
        overrides: Overrides,
        route: GatewayConnection.Route?) async -> Bool?
    {
        if let supportsGatewayMethod = overrides.supportsGatewayMethod {
            return supportsGatewayMethod(method.rawValue)
        }
        guard let route else { return nil }
        return await GatewayConnection.shared.supportsServerMethod(method.rawValue, ifCurrentRoute: route)
    }

    @MainActor
    private static func writeGateway(
        _ root: [String: Any],
        method: GatewayConnection.Method,
        overrides: Overrides,
        baseHash: String? = nil,
        ifCurrentRoute route: GatewayConnection.Route? = nil) async throws -> String?
    {
        if let writeGateway = overrides.writeGateway {
            return try await writeGateway(method.rawValue, root, baseHash)
        }
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        guard let raw = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ConfigStore", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to encode config.",
            ])
        }
        var params: [String: AnyCodable] = ["raw": AnyCodable(raw)]
        if let baseHash {
            params["baseHash"] = AnyCodable(baseHash)
        }
        let ack: ConfigWriteAck = if let route {
            try await GatewayConnection.shared.requestDecoded(
                method: method,
                params: params,
                timeoutMs: 10000,
                ifCurrentRoute: route)
        } else {
            try await GatewayConnection.shared.requestDecoded(
                method: method,
                params: params,
                timeoutMs: 10000)
        }
        return ack.hash
    }

    @MainActor
    private static func saveBrowserLocally(_ enabled: Bool, overrides: Overrides) throws {
        var root = overrides.loadLocal?() ?? OpenClawConfigFile.loadDict()
        var browser = root["browser"] as? [String: Any] ?? [:]
        browser["enabled"] = enabled
        root["browser"] = browser
        if let saveLocal = overrides.saveLocal {
            saveLocal(root)
        } else if !OpenClawConfigFile.saveDict(root, preserveExistingKeys: true) {
            throw NSError(domain: "ConfigStore", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Local config write rejected to protect gateway auth/mode.",
            ])
        }
    }

    @MainActor
    private static func saveLocally(
        _ root: [String: Any],
        overrides: Overrides,
        allowGatewayAuthMutation: Bool) throws
    {
        if let saveLocal = overrides.saveLocal {
            saveLocal(root)
        } else if !OpenClawConfigFile.saveDict(
            root,
            preserveExistingKeys: true,
            allowGatewayAuthMutation: allowGatewayAuthMutation)
        {
            throw NSError(domain: "ConfigStore", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Local config write rejected to protect gateway auth/mode.",
            ])
        }
    }

    private static func postChangeNotification(overrides: Overrides) {
        #if DEBUG
        let notificationCenter = overrides.notificationCenter ?? .default
        #else
        let notificationCenter = NotificationCenter.default
        #endif
        notificationCenter.post(name: .openclawConfigDidChange, object: nil)
    }

    @MainActor
    private static func saveToGateway(
        _ root: [String: Any],
        baseHash: String?,
        ifCurrentRoute route: GatewayConnection.Route?) async throws
    {
        let overrides = await self.overrideStore.overrides
        if let saveGateway = overrides.saveGateway {
            try await saveGateway(root)
            return
        }
        if route == nil, overrides.writeGateway == nil {
            preconditionFailure("Gateway route required")
        }
        _ = try await self.writeGateway(
            root,
            method: .configSet,
            overrides: overrides,
            baseHash: baseHash,
            ifCurrentRoute: route)
    }

    #if DEBUG
    static func _testSetOverrides(_ overrides: Overrides) async {
        await self.overrideStore.setOverride(overrides)
    }

    static func _testClearOverrides() async {
        await self.overrideStore.setOverride(.init())
    }

    #endif
}

extension Notification.Name {
    static let openclawConfigDidChange = Notification.Name("openclaw.config.did-change")
}
