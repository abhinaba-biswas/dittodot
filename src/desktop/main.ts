import { spawn, type Subprocess } from "bun";
import Electrobun, { ApplicationMenu, BrowserWindow, GlobalShortcut, type ApplicationMenuItem } from "electrobun/main";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import type { DesktopRPCRequest, DesktopRPCResponse } from "./types";

// Setup OS-specific application data directory
export function resolveDataDir(): string {
  if (process.env.DOTS_DATA_DIR) {
    return process.env.DOTS_DATA_DIR;
  }

  const home = os.homedir();
  const platform = process.platform;

  let dir: string;
  if (platform === "darwin") {
    dir = path.join(home, "Library", "Application Support", "Ditto");
  } else if (platform === "win32") {
    dir = path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Ditto");
  } else {
    // Linux / FreeDesktop XDG
    dir = path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "ditto");
  }

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const DATA_DIR = resolveDataDir();
process.env.DOTS_DATA_DIR = DATA_DIR;

let serverProcess: Subprocess | null = null;

// Records the server we spawned, so a later launch can reap it if this process dies without cleaning up.
const SERVER_PID_FILE = path.join(DATA_DIR, "server.pid");

/** Resolves true when something accepts TCP connections on the port. */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Checks if a port is available on localhost
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  // Binding 127.0.0.1 alone succeeds on macOS even when another server holds the wildcard address,
  // so ask whether anything answers first, then bind the wildcard address the server itself would use.
  if (await isPortListening(port)) return false;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

/** Stops a server left behind by a previous launch that exited without cleaning up. */
async function reapStaleServer(): Promise<void> {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(SERVER_PID_FILE, "utf8").trim());
  } catch {
    return;
  }
  fs.rmSync(SERVER_PID_FILE, { force: true });
  if (!Number.isInteger(pid) || pid <= 1 || process.platform === "win32") return;
  try {
    // The pid may have been reused by an unrelated process since, so only kill a Next.js server.
    const ps = spawn({ cmd: ["ps", "-o", "command=", "-p", String(pid)], stdout: "pipe", stderr: "ignore" });
    const command = await new Response(ps.stdout).text();
    if (!/next/i.test(command)) return;
    console.log(`[Desktop-Host] Stopping leftover server from a previous launch (pid ${pid})`);
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      process.kill(pid, 0);
    }
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone
  }
}

function stopServer() {
  if (!serverProcess) return;
  try {
    serverProcess.kill();
  } catch {
    // Ignored
  }
  serverProcess = null;
  fs.rmSync(SERVER_PID_FILE, { force: true });
}

/**
 * Finds an available port starting from startPort
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > startPort + 50) {
      throw new Error(`Could not find an available port in range ${startPort}-${port}`);
    }
  }
  return port;
}

export function findProjectRoot(): string {
  if (process.env.DITTO_ROOT && fs.existsSync(process.env.DITTO_ROOT)) {
    return process.env.DITTO_ROOT;
  }
  let curr = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(curr, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(curr, "package.json"), "utf8"));
        if (pkg.name === "ditto") return curr;
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

/**
 * Boots the embedded Next.js standalone server using Bun
 */
export async function startNextServer(preferredPort = 3100): Promise<{ url: string; port: number }> {
  const projectRoot = findProjectRoot();
  const standaloneServer = path.join(projectRoot, ".next", "standalone", "server.js");

  await reapStaleServer();

  // Check if port is already running our server
  const portFree = await isPortAvailable(preferredPort);
  let activePort = preferredPort;

  if (!portFree) {
    const testUrl = `http://127.0.0.1:${preferredPort}`;
    try {
      const res = await fetch(`${testUrl}/api/events`, { signal: AbortSignal.timeout(1500) });
      if (res.status >= 200 && res.status < 500) {
        console.log(`[Desktop-Host] Attached to existing local server at ${testUrl}`);
        return { url: testUrl, port: preferredPort };
      }
    } catch {
      // Not responsive, choose next available port
    }
    activePort = await findAvailablePort(preferredPort + 1);
  }

  const serverUrl = `http://127.0.0.1:${activePort}`;

  if (fs.existsSync(standaloneServer)) {
    console.log(`[Desktop-Host] Starting standalone Next.js server on port ${activePort}...`);
    serverProcess = spawn({
      cmd: ["node", standaloneServer],
      cwd: path.join(projectRoot, ".next", "standalone"),
      env: {
        ...process.env,
        PORT: String(activePort),
        // The standalone server reads HOSTNAME (not HOST) for its bind address.
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        DOTS_DATA_DIR: DATA_DIR,
        NEXT_PUBLIC_DESKTOP: "true",
      },
      stdout: "inherit",
      stderr: "inherit",
    });
  } else {
    console.log(`[Desktop-Host] Starting Next.js dev server on port ${activePort}...`);
    const nextBin = path.join(projectRoot, "node_modules", ".bin", "next");
    serverProcess = spawn({
      cmd: fs.existsSync(nextBin)
        ? [nextBin, "dev", "--port", String(activePort)]
        : ["npx", "next", "dev", "--port", String(activePort)],
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(activePort),
        DOTS_DATA_DIR: DATA_DIR,
        NEXT_PUBLIC_DESKTOP: "true",
      },
      stdout: "inherit",
      stderr: "inherit",
    });
  }

  fs.writeFileSync(SERVER_PID_FILE, String(serverProcess.pid));

  // Wait for server health check
  await waitForServer(`${serverUrl}/api/events`);
  console.log(`[Desktop-Host] Embedded Next.js server ready at ${serverUrl}`);
  return { url: serverUrl, port: activePort };
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status >= 200 && res.status < 500) {
        return;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.warn(`[Desktop-Host] Timed out waiting for server at ${url}, proceeding anyway...`);
}

/**
 * Handle RPC requests from the Webview frontend
 */
export async function handleRPC(rawMessage: string): Promise<string> {
  try {
    const req: DesktopRPCRequest = JSON.parse(rawMessage);
    let result: unknown = null;

    switch (req.type) {
      case "system:getInfo":
        result = {
          platform: process.platform,
          arch: process.arch,
          dataDir: DATA_DIR,
          bunVersion: Bun.version,
        };
        break;

      case "system:notify":
        console.log("[Desktop-RPC] Notification:", req.payload);
        result = true;
        break;

      case "app:quit":
        cleanupAndExit(0);
        break;

      default:
        result = { handled: true };
    }

    const res: DesktopRPCResponse = { success: true, data: result };
    return JSON.stringify(res);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const res: DesktopRPCResponse = { success: false, error: errorMsg };
    return JSON.stringify(res);
  }
}

function cleanupAndExit(code = 0) {
  console.log("[Desktop-Host] Shutting down application...");
  try {
    GlobalShortcut.unregisterAll();
  } catch {
    // Ignored
  }
  stopServer();
  process.exit(code);
}

// Cmd+Q and the Quit menu item shut down natively and may not reach the handlers below.
Electrobun.events.on("before-quit", stopServer);

// Attach process termination handlers
process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));
process.on("exit", () => cleanupAndExit(0));

/**
 * Native macOS menu bar. WKWebView only honours Cmd+C/V/X/A/Z, Cmd+Q, Cmd+W and friends when a menu
 * with matching key equivalents exists, so these roles are what make the standard shortcuts work.
 */
function installAppMenu() {
  const mod = "CommandOrControl";
  const menu: ApplicationMenuItem[] = [
    {
      label: "Ditto",
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "hide", accelerator: `${mod}+H` },
        { role: "hideOthers", accelerator: `${mod}+Alt+H` },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit", accelerator: `${mod}+Q` },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", accelerator: `${mod}+Z` },
        { role: "redo", accelerator: `${mod}+Shift+Z` },
        { type: "divider" },
        { role: "cut", accelerator: `${mod}+X` },
        { role: "copy", accelerator: `${mod}+C` },
        { role: "paste", accelerator: `${mod}+V` },
        { role: "pasteAndMatchStyle", accelerator: `${mod}+Alt+Shift+V` },
        { role: "delete" },
        { role: "selectAll", accelerator: `${mod}+A` },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "toggleFullScreen", accelerator: "Ctrl+Command+F" }],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", accelerator: `${mod}+M` },
        { role: "zoom" },
        { role: "close", accelerator: `${mod}+W` },
        { type: "divider" },
        { role: "bringAllToFront" },
      ],
    },
  ];
  try {
    ApplicationMenu.setApplicationMenu(menu);
  } catch (err) {
    console.warn("[Desktop-Host] Could not install application menu:", err);
  }
}

/** Double-clicking the title area zooms (maximizes) the window, like any native Mac app. */
function toggleMaximize(win: BrowserWindow) {
  if (win.isFullScreen()) return win.setFullScreen(false);
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}

/** Starts or ends a voice call in the page, bringing the window forward first. */
const VOICE_HOTKEY = "CommandOrControl+Shift+Space";

function wireWindow(win: BrowserWindow) {
  // The page reports gestures it can't handle itself (WKWebView has no native titlebar double-click here).
  win.webview.on("host-message", (event) => {
    let msg: unknown = event.data?.detail;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch {
        return;
      }
    }
    if ((msg as { type?: string } | null)?.type === "window:toggleMaximize") toggleMaximize(win);
  });

  // A system-wide shortcut works while Ditto is in the background; the page falls back to its own key handler if it fails.
  const ok = GlobalShortcut.register(VOICE_HOTKEY, () => {
    if (win.isMinimized()) win.unminimize();
    win.show();
    win.focus();
    win.webview.executeJavascript("window.dispatchEvent(new CustomEvent('ditto:voice-toggle'))");
  });
  if (ok) win.webview.executeJavascript("window.__dittoGlobalHotkey = true");
  else console.warn(`[Desktop-Host] Could not register global shortcut ${VOICE_HOTKEY}`);
  // The flag is lost on reload/navigation, so set it again once the page is ready.
  win.webview.on("dom-ready", () => {
    if (ok) win.webview.executeJavascript("window.__dittoGlobalHotkey = true");
  });
}

// Desktop Launcher main entry
export async function main() {
  console.log("[Desktop-Host] Launching Ditto Desktop App...");
  console.log(`[Desktop-Host] Application Data Directory: ${DATA_DIR}`);

  const requestedPort = Number(process.env.PORT) || 3100;
  const { url: serverUrl } = await startNextServer(requestedPort);

  console.log(`[Desktop-Host] Opening Native Webview window at ${serverUrl}`);

  if (process.platform === "darwin") installAppMenu();

  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      title: "Ditto",
      url: serverUrl,
      frame: {
        width: 1280,
        height: 840,
      },
      titleBarStyle: "hiddenInset",
      spellCheck: true,
    });
    wireWindow(win);
    console.log("[Desktop-Host] Native BrowserWindow opened successfully.");
  } catch (err) {
    console.warn("[Desktop-Host] Note on BrowserWindow instantiation:", err);
  }

  // Keep process active while the standalone server or UI runs
  if (serverProcess) {
    await serverProcess.exited;
  } else {
    // Keep alive in attach mode
    await new Promise(() => {});
  }
}

if (import.meta.main) {
  void main().catch((err) => {
    console.error("[Desktop-Host] Failed to launch desktop app:", err);
    cleanupAndExit(1);
  });
}
