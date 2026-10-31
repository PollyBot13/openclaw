import AppKit
import ApplicationServices
import Foundation
import Darwin
import Testing
@MainActor
private final class PreferenceProofTracking: NSObject {
    let menu: NSMenu
    let window: NSWindow
    let output: URL
    let label: String
    let selection: NSMenuItem?
    private var inspection: Timer?
    private var deadline: Timer?
    private var inputTimers: [Timer] = []
    private var pendingInputs: [CGEvent] = []
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
        let pointer = try proofRequire(CGEvent(source: nil)?.location)
        defer { assert(CGWarpMouseCursorPosition(pointer) == .success) }
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
                    self.inputTimers.forEach { $0.invalidate() }
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

    @objc private func sendInput() {
        guard !self.pendingInputs.isEmpty else { return }
        let event = self.pendingInputs.removeFirst()
        print("INPUT TIMER", event.type.rawValue, "active", NSApp.isActive, "postAllowed", CGPreflightPostEventAccess())
        if ProcessInfo.processInfo.environment["PROBE_ROUTE"] == "ns" {
            let number = Int(event.getIntegerValueField(.mouseEventWindowUnderMousePointer))
            let location = NSApp.window(withWindowNumber: number)!.convertPoint(fromScreen: NSEvent.mouseLocation)
            let type: NSEvent.EventType = event.type == .mouseMoved ? .mouseMoved : event.type == .leftMouseDown ? .leftMouseDown : .leftMouseUp
            NSApp.postEvent(NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: number, context: nil, eventNumber: 1, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)!, atStart: false)
        } else { event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: 0); event.post(tap: .cgSessionEventTap) }
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
                let primaryScreen = try proofRequire(NSScreen.screens.first)
                let point = CGPoint(x: frame.midX, y: primaryScreen.frame.maxY - frame.midY)
                try proofRequire(CGWarpMouseCursorPosition(point) == .success)
                let localPoint = menuWindow.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
                let eventTypes: [CGEventType] = [.mouseMoved, .leftMouseDown, .leftMouseUp]
                let events = try eventTypes.map { type in
                    try proofRequire(CGEvent(mouseEventSource: nil, mouseType: type,
                                         mouseCursorPosition: point, mouseButton: .left))
                }
                try JSONSerialization.data(withJSONObject: [
                    "method": ProcessInfo.processInfo.environment["PROBE_ROUTE"] == "ns" ? "diagnostic NSEvent owned-queue routing" : "diagnostic CGEvent session routing without window hint",
                    "windowNumber": menuWindow.windowNumber,
                    "appKitScreenPoint": ["x": frame.midX, "y": frame.midY],
                    "quartzScreenPoint": ["x": point.x, "y": point.y],
                    "windowPoint": ["x": localPoint.x, "y": localPoint.y],
                    "pointerAfterWarp": ["x": NSEvent.mouseLocation.x, "y": NSEvent.mouseLocation.y],
                    "item": selection.title,
                ], options: [.prettyPrinted, .sortedKeys])
                    .write(to: self.output.appendingPathComponent("\(self.label)-click.json"))
                // WindowServer must route input to the tracked menu on the disposable VM.
                // This proof must never run on an operator desktop.
                for event in events { event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(menuWindow.windowNumber)) }; self.pendingInputs = events
                for index in events.indices {
                    let timer = Timer(timeInterval: 0.15 * Double(index + 1), target: self,
                                      selector: #selector(self.sendInput), userInfo: nil, repeats: false)
                    self.inputTimers.append(timer)
                    RunLoop.main.add(timer, forMode: .eventTracking)
                    RunLoop.main.add(timer, forMode: .common)
                }
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


func proofRequire<T>(_ value: T?) throws -> T { guard let value else { throw NSError(domain: "probe", code: 1) }; return value }
func proofRequire(_ value: Bool) throws { if !value { throw NSError(domain: "probe", code: 2) } }
@MainActor private final class Receiver: NSObject {
 var actions = 0
 @objc func selected(_ sender: NSMenuItem) { actions += 1; print("ACTUAL ACTION", sender.title) }
}

@Test @MainActor func hostedNativeTestContext() async throws {
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.finishLaunching()
await withCheckedContinuation { continuation in
 RunLoop.main.perform(inModes: [.common]) {
  MainActor.assumeIsolated {
   let started = Timer(timeInterval: 0, repeats: false) { _ in continuation.resume() }
   RunLoop.main.add(started, forMode: .common)
   app.run()
  }
 }
}
print("ENV postAllowed", CGPreflightPostEventAccess(), "AXTrusted", AXIsProcessTrusted(), "pid", ProcessInfo.processInfo.processIdentifier)
let receiver = Receiver()
let window = NSWindow(contentRect: NSRect(x:120,y:150,width:500,height:240), styleMask:[.titled], backing:.buffered, defer:false)
window.isReleasedWhenClosed = false
window.title = "Synthetic hosted input diagnostic"
window.orderFrontRegardless()
app.activate(ignoringOtherApps:true)
let monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .leftMouseUp]) { e in print("LOCAL EVENT",e.type.rawValue,"window",e.windowNumber,"point",e.locationInWindow); return e }
let parent = NSMenu()
let parentItem = NSMenuItem(title: "Session", action: nil, keyEquivalent: "")
parent.addItem(parentItem)
let menu = NSMenu()
menu.autoenablesItems = false
menu.showsStateColumn = true
menu.appearance = app.effectiveAppearance
if ["one", "reused", "defaultmode", "pause"].contains(ProcessInfo.processInfo.environment["PROBE_CONTEXT"] ?? "") { parentItem.submenu = menu }

for title in ["Off", "Low", "High"] { let item = NSMenuItem(title:title, action:#selector(Receiver.selected(_:)), keyEquivalent: ""); item.target=receiver; menu.addItem(item) }
do {
  if ["one", "reused", "defaultmode", "pause"].contains(ProcessInfo.processInfo.environment["PROBE_CONTEXT"] ?? "") {
   for index in 0..<(ProcessInfo.processInfo.environment["PROBE_CONTEXT"] == "one" ? 1 : 10) {
    try await PreferenceProofTracking(menu: menu, window: window, output: URL(fileURLWithPath: ProcessInfo.processInfo.environment["PROBE_OUTPUT"]!), label: "capture-\(index)").run()
    print("CAPTURE RETURN", index, "running", app.isRunning, "active", app.isActive, "event", String(describing: app.currentEvent))
    if ProcessInfo.processInfo.environment["PROBE_CONTEXT"] == "defaultmode" {
     await withCheckedContinuation { continuation in
      RunLoop.main.perform(inModes: [.default]) { continuation.resume() }
      CFRunLoopWakeUp(CFRunLoopGetMain())
     }
    }
    if ProcessInfo.processInfo.environment["PROBE_CONTEXT"] == "pause" { try await Task.sleep(for: .milliseconds(500)) }

   }
  }
  try await PreferenceProofTracking(menu:menu, window:window, output:URL(fileURLWithPath:ProcessInfo.processInfo.environment["PROBE_OUTPUT"]!), label:"probe", selection:menu.items[0]).run()
  print("TRACKING ACCEPTED actions", receiver.actions)
  #expect(receiver.actions == 1)
 } catch { print("FAILED", error); throw error }
window.close()
if let monitor { NSEvent.removeMonitor(monitor) }

}
