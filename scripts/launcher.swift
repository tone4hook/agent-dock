// CFBundleExecutable for agent-dock.app.
//
// The previous launcher was a #!/bin/bash script. macOS Sequoia
// Gatekeeper rejects bash-script CFBundleExecutables with
// "no usable signature" even when the bundle is correctly signed
// and notarized — the runtime entry-point check requires a Mach-O.
// This binary takes its place.
//
// Responsibilities (mirrors the previous bash logic):
//   1. Locate Node 20+ (system PATH, then well-known install dirs).
//   2. Build a richer PATH so spawned CLIs (claude, gemini, codex,
//      gh, git) resolve under launchd's minimal default PATH.
//   3. Fork the API child via Node + launch-api.mjs, redirecting
//      stdio to ~/Library/Logs/agent-dock-api.log.
//   4. Reap the child on launcher exit (atexit + signal handlers).
//   5. chdir to Contents/Resources/, then execv the Neutralino
//      binary (replaces the launcher process; Neutralino finds
//      resources.neu adjacent to itself).

import Foundation
import Darwin

// MARK: - Helpers

let fm = FileManager.default
let env = ProcessInfo.processInfo.environment
let home = env["HOME"] ?? NSHomeDirectory()

func alertAndExit(_ message: String) -> Never {
    let script = "display alert \"Agent*Dock\" message \"\(message)\" as critical"
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    try? p.run()
    p.waitUntilExit()
    FileHandle.standardError.write(Data("[agent-dock] \(message)\n".utf8))
    exit(1)
}

func exists(_ path: String) -> Bool { fm.fileExists(atPath: path) }

func isExecutable(_ path: String) -> Bool {
    var st = stat()
    guard stat(path, &st) == 0, (st.st_mode & S_IXUSR) != 0 else { return false }
    return true
}

/// Expand `~/foo` and a single trailing-segment glob (e.g. `~/.nvm/versions/node/*/bin/node`).
/// Returns the first matching path that exists.
func expandFirstMatch(_ pattern: String) -> String? {
    let expanded = pattern.replacingOccurrences(of: "~", with: home)
    if !expanded.contains("*") {
        return exists(expanded) ? expanded : nil
    }
    // Split on `*` — only one wildcard segment supported, which is enough for our patterns.
    let components = expanded.split(separator: "*", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    guard components.count == 2 else { return nil }
    let prefix = components[0]   // e.g. "/Users/x/.nvm/versions/node/"
    let suffix = components[1]   // e.g. "/bin/node"
    let parentURL = URL(fileURLWithPath: prefix.hasSuffix("/") ? String(prefix.dropLast()) : prefix)
    let parent = parentURL.path
    let parentDir = (parent as NSString).deletingLastPathComponent
    let leadingFragment = (parent as NSString).lastPathComponent
    guard let entries = try? fm.contentsOfDirectory(atPath: parentDir) else { return nil }
    for entry in entries.sorted() {
        let candidate = "\(parentDir)/\(entry)\(suffix)"
        if entry.hasPrefix(leadingFragment) || leadingFragment.isEmpty {
            if exists(candidate) && isExecutable(candidate) { return candidate }
        }
    }
    return nil
}

func findNode() -> String? {
    // 1. PATH lookup.
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = ["which", "node"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = Pipe()
    do {
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus == 0 {
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !path.isEmpty && isExecutable(path) { return path }
        }
    } catch {
        // fall through to known-paths probe
    }

    // 2. Well-known install dirs.
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "~/.volta/bin/node",
        "~/.nvm/versions/node/*/bin/node",
        "~/.fnm/node-versions/*/installation/bin/node",
        "~/Library/Application Support/fnm/node-versions/*/installation/bin/node",
        "~/.asdf/installs/nodejs/*/bin/node",
    ]
    for pattern in candidates {
        if let hit = expandFirstMatch(pattern), isExecutable(hit) {
            return hit
        }
    }
    return nil
}

// MARK: - Resolve bundle paths

guard let resourcePath = Bundle.main.resourcePath else {
    alertAndExit("Could not resolve Bundle.main.resourcePath. Is agent-dock running outside its .app bundle?")
}
let neutralinoPath = "\(resourcePath)/neutralino"
let resourcesNeu = "\(resourcePath)/resources.neu"
let launchApi = "\(resourcePath)/launch-api.mjs"

guard exists(neutralinoPath) else {
    alertAndExit("Bundle is missing Contents/Resources/neutralino. Reinstall the app.")
}
guard exists(resourcesNeu) else {
    alertAndExit("Bundle is missing Contents/Resources/resources.neu. Reinstall the app.")
}
guard exists(launchApi) else {
    alertAndExit("Bundle is missing Contents/Resources/launch-api.mjs. Reinstall the app.")
}

// MARK: - Node lookup

guard let nodeBin = findNode() else {
    alertAndExit("Agent*Dock requires Node.js 20+. Install Node from https://nodejs.org and relaunch.")
}
let nodeDir = (nodeBin as NSString).deletingLastPathComponent

// MARK: - Log file

let logDir = "\(home)/Library/Logs"
try? fm.createDirectory(atPath: logDir, withIntermediateDirectories: true)
let logPath = "\(logDir)/agent-dock-api.log"
let logFd = open(logPath, O_WRONLY | O_CREAT | O_APPEND, 0o644)
if logFd < 0 {
    alertAndExit("Could not open log file at \(logPath).")
}
let logHandle = FileHandle(fileDescriptor: logFd, closeOnDealloc: true)
logHandle.write(Data("[agent-dock] launcher start; node=\(nodeBin)\n".utf8))

// MARK: - Build extended PATH for the API child

let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
let extraPath = [
    nodeDir,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "\(home)/.volta/bin",
    "\(home)/.local/bin",
    "\(home)/.cargo/bin",
].joined(separator: ":")
let childPath = "\(extraPath):\(existingPath)"

// MARK: - Data dirs

let dataDir = env["AGENT_DOCK_DATA_DIR"] ?? "\(home)/.agent-dock"
let artifactDir = env["AGENT_DOCK_ARTIFACT_DIR"] ?? "\(dataDir)/artifacts"
try? fm.createDirectory(atPath: dataDir, withIntermediateDirectories: true)
try? fm.createDirectory(atPath: artifactDir, withIntermediateDirectories: true)

// MARK: - Spawn the API child

let api = Process()
api.executableURL = URL(fileURLWithPath: nodeBin)
api.arguments = [launchApi]
api.currentDirectoryURL = URL(fileURLWithPath: dataDir)
var childEnv = env
childEnv["PATH"] = childPath
childEnv["AGENT_DOCK_PRODUCTION"] = "1"
childEnv["AGENT_DOCK_DATA_DIR"] = dataDir
childEnv["AGENT_DOCK_ARTIFACT_DIR"] = artifactDir
childEnv["NODE_PATH"] = "\(resourcePath)/node_modules"
api.environment = childEnv
api.standardOutput = logHandle
api.standardError = logHandle

do {
    try api.run()
} catch {
    alertAndExit("Failed to launch Agent*Dock API: \(error.localizedDescription)")
}
let apiPid = api.processIdentifier
logHandle.write(Data("[agent-dock] api pid=\(apiPid)\n".utf8))

// MARK: - Reap child on exit

func reapAndExit(_ sig: Int32) {
    kill(apiPid, SIGTERM)
    exit(sig == 0 ? 0 : 128 + sig)
}
atexit { kill(apiPid, SIGTERM) }
signal(SIGTERM) { _ in reapAndExit(SIGTERM) }
signal(SIGINT)  { _ in reapAndExit(SIGINT)  }
signal(SIGHUP)  { _ in reapAndExit(SIGHUP)  }

// MARK: - chdir + execv into Neutralino

guard chdir(resourcePath) == 0 else {
    alertAndExit("chdir to Contents/Resources failed: \(String(cString: strerror(errno)))")
}

// execv replaces the current process. argv[0] is the program name
// shown in ps; argv[1..] is the actual arg list. Pass --window-mode=window
// so Neutralino opens its window rather than the dev cloud-window mode.
let argv: [UnsafeMutablePointer<CChar>?] = [
    strdup("neutralino"),
    strdup("--window-mode=window"),
    nil,
]
execv(neutralinoPath, argv)

// execv only returns on failure.
let err = String(cString: strerror(errno))
alertAndExit("execv neutralino failed: \(err)")
