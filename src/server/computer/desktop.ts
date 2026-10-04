import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit } from "../bus";
import { clickScript, typeScript } from "./dom-actions";
import type { ComputerAction } from "./browser";

// The user's real Mac as the dot's screen: their own browser, their own apps. Used when full access is on (macOS only).
//   open               → opens URLs in the default browser
//   screencapture+sips → what the model sees (downscaled to 1280px wide)
//   JXA (osascript)    → mouse clicks/drags/scroll via CoreGraphics, typing and keys via System Events
// macOS asks once for Screen Recording and Accessibility permission for the app that runs this.

const SHOT_WIDTH = 1280;
const shots = new Map<string, Buffer>();

export const desktopSupported = () => process.platform === "darwin";

function exec(cmd: string, args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.toString());
    });
  });
}
const jxa = (script: string, arg: unknown) =>
  exec("osascript", ["-l", "JavaScript", "-e", `function run(argv){const a=JSON.parse(argv[0]);${script}}`, JSON.stringify(arg)]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- screen ----------

let pointsPerPx = 1;

export async function screenshot(dotId: string): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `ditto-shot-${process.pid}-${Date.now()}.jpg`);
  try {
    await exec("screencapture", ["-x", "-t", "jpg", file]);
    await exec("sips", ["-Z", String(SHOT_WIDTH), file]);
    const w = Number((await exec("sips", ["-g", "pixelWidth", file])).match(/pixelWidth: (\d+)/)?.[1] ?? SHOT_WIDTH);
    const pts = Number((await jxa("ObjC.import('AppKit');return String($.NSScreen.mainScreen.frame.size.width);", null)).trim());
    if (pts > 0 && w > 0) pointsPerPx = pts / w;
    const buf = fs.readFileSync(file);
    shots.set(dotId, buf);
    emit({ type: "screen", dotId, at: Date.now() });
    return buf;
  } catch (err) {
    throw new Error(
      `Couldn't capture the screen. Allow Ditto under System Settings → Privacy & Security → Screen Recording. (${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export const lastScreenshot = async (dotId: string) => shots.get(dotId) ?? null;

// ---------- browser ----------

export async function openUrl(dotId: string, url: string): Promise<string> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  await exec("open", [target]);
  await sleep(2500);
  await screenshot(dotId).catch(() => {});
  return `Opened ${target} in the user's own default browser. Use read_page, click and type_text to work on it.`;
}

// Runs a script in the active tab of the user's browser over Apple Events, so models without the screen tool
// can still read, click and type. The frontmost browser wins; otherwise the first one that is running.
const BROWSERS = ["Google Chrome", "Brave Browser", "Microsoft Edge", "Arc", "Safari"];
const IN_PAGE = `
let front = '';
try { front = Application('System Events').applicationProcesses.whose({frontmost: true})[0].name(); } catch (e) {}
const order = a.apps.filter((n) => n === front).concat(a.apps.filter((n) => n !== front));
let lastError = 'No supported browser is open.';
for (const app of order) {
  try {
    const A = Application(app);
    if (!A.running() || !A.windows.length) continue;
    const out = app === 'Safari'
      ? A.doJavaScript(a.js, {in: A.windows[0].currentTab()})
      : A.windows[0].activeTab().execute({javascript: a.js});
    return JSON.stringify({ ok: true, app, out: out == null ? '' : String(out) });
  } catch (e) { lastError = app + ': ' + e.message; }
}
return JSON.stringify({ ok: false, error: lastError });`;

const ALLOW_HINT =
  "The user's browser must allow scripting once: in Chrome/Brave/Edge, View → Developer → Allow JavaScript from Apple Events; in Safari, Develop → Allow JavaScript from Apple Events. Tell the user, then try again.";

/** Evaluate an expression in the user's active tab; the expression's JSON-serialised value comes back parsed. */
async function inPage<T>(expr: string): Promise<{ ok: true; value: T; app: string } | { ok: false; error: string }> {
  try {
    const raw = await jxa(IN_PAGE, { apps: BROWSERS, js: `JSON.stringify(${expr})` });
    const res = JSON.parse(raw) as { ok: boolean; app?: string; out?: string; error?: string };
    if (!res.ok) return { ok: false, error: `${res.error ?? "Couldn't reach the browser."} ${ALLOW_HINT}` };
    return { ok: true, value: JSON.parse(res.out || "null") as T, app: res.app ?? "" };
  } catch (err) {
    return { ok: false, error: `${err instanceof Error ? err.message : String(err)} ${ALLOW_HINT}` };
  }
}

export async function readPage(): Promise<string> {
  const r = await inPage<{ url: string; title: string; text: string }>("({url: location.href, title: document.title, text: document.body ? document.body.innerText : ''})");
  if (!r.ok) return r.error;
  return `Browser: ${r.app}\nURL: ${r.value.url}\nTitle: ${r.value.title}\n\n${r.value.text.replace(/\n{3,}/g, "\n\n").slice(0, 15_000)}`;
}

export async function clickText(dotId: string, text: string): Promise<string> {
  const r = await inPage<{ ok: boolean; label?: string; error?: string }>(clickScript(text));
  if (!r.ok) return r.error;
  if (!r.value?.ok) return r.value?.error ?? "Couldn't click that.";
  await sleep(900);
  await screenshot(dotId).catch(() => {});
  return `Clicked "${r.value.label || text}" in the user's ${r.app}. Read the page to see what changed.`;
}

export async function typeText(dotId: string, field: string, value: string, submit: boolean): Promise<string> {
  const r = await inPage<{ ok: boolean; error?: string }>(typeScript(field, value, submit));
  if (!r.ok) return r.error;
  if (!r.value?.ok) return r.value?.error ?? "Couldn't find that field.";
  await sleep(submit ? 1200 : 300);
  await screenshot(dotId).catch(() => {});
  return submit ? `Typed into "${field}" and submitted, in the user's ${r.app}.` : `Typed into "${field}" in the user's ${r.app}.`;
}
export const fillLogin = async () => "Saved passwords aren't typed into the user's own browser. Ask the user to sign in themselves, or take over.";

// ---------- mouse & keyboard ----------

const MOUSE = `
ObjC.import('CoreGraphics');
const T = {down:[$.kCGEventLeftMouseDown,$.kCGEventRightMouseDown,$.kCGEventOtherMouseDown], up:[$.kCGEventLeftMouseUp,$.kCGEventRightMouseUp,$.kCGEventOtherMouseUp], drag:[$.kCGEventLeftMouseDragged,$.kCGEventRightMouseDragged,$.kCGEventOtherMouseDragged]};
const B = [$.kCGMouseButtonLeft,$.kCGMouseButtonRight,$.kCGMouseButtonCenter];
const post = (e) => $.CGEventPost($.kCGHIDEventTap, e);
const pt = (p) => ({x:p.x, y:p.y});
const b = a.button || 0;
for (const step of a.steps) {
  if (step.k === 'move') post($.CGEventCreateMouseEvent(null,$.kCGEventMouseMoved,pt(step),0));
  if (step.k === 'down') post($.CGEventCreateMouseEvent(null,T.down[b],pt(step),B[b]));
  if (step.k === 'up') post($.CGEventCreateMouseEvent(null,T.up[b],pt(step),B[b]));
  if (step.k === 'drag') post($.CGEventCreateMouseEvent(null,T.drag[b],pt(step),B[b]));
  if (step.k === 'scroll') post($.CGEventCreateScrollWheelEvent(null,$.kCGScrollEventUnitPixel,2,step.dy,step.dx));
  delay(step.wait || 0.03);
}
return 'ok';`;

type Step = { k: "move" | "down" | "up" | "drag" | "scroll"; x?: number; y?: number; dx?: number; dy?: number; wait?: number };
const mouse = (steps: Step[], button = 0) => jxa(MOUSE, { steps, button });
const at = (x: number, y: number) => ({ x: Math.round(x * pointsPerPx), y: Math.round(y * pointsPerPx) });
const click = (x: number, y: number, times = 1): Step[] => {
  const p = at(x, y);
  const out: Step[] = [{ k: "move", ...p }];
  for (let i = 0; i < times; i++) out.push({ k: "down", ...p }, { k: "up", ...p });
  return out;
};

const KEY_CODES: Record<string, number> = {
  RETURN: 36, ENTER: 36, TAB: 48, SPACE: 49, BACKSPACE: 51, DELETE: 51, ESC: 53, ESCAPE: 53, LEFT: 123, RIGHT: 124, DOWN: 125, UP: 126,
  HOME: 115, END: 119, PAGEUP: 116, PAGEDOWN: 121, F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
};
const MODS: Record<string, string> = { CMD: "command", COMMAND: "command", META: "command", SUPER: "command", CTRL: "control", CONTROL: "control", ALT: "option", OPTION: "option", SHIFT: "shift" };

async function keypress(keys: string[]) {
  const mods = [...new Set(keys.map((k) => MODS[k.toUpperCase()]).filter(Boolean))];
  const main = keys.find((k) => !MODS[k.toUpperCase()]);
  if (!main) return;
  const using = mods.length ? ` using {${mods.map((m) => `${m} down`).join(", ")}}` : "";
  const code = KEY_CODES[main.toUpperCase()];
  const body = code !== undefined ? `key code ${code}${using}` : `keystroke (item 1 of argv)${using}`;
  await exec("osascript", ["-e", "on run argv", "-e", `tell application "System Events" to ${body}`, "-e", "end run", "--", main.length === 1 ? main : ""]);
}

// ---------- apps by keyboard ----------
// For models without the screen tool: they can't see or click, but they can drive an app with its shortcuts.

const ACCESS_HINT = "Allow Ditto under System Settings → Privacy & Security → Accessibility, then try again.";

/** The frontmost app and its window title, so a model that can't see the screen knows where its keys landed. */
async function frontWindow(): Promise<string> {
  const out = await exec("osascript", [
    "-e", 'tell application "System Events"',
    "-e", "set p to first application process whose frontmost is true",
    "-e", "set n to name of p",
    "-e", "try",
    "-e", "set w to name of front window of p",
    "-e", "on error",
    "-e", 'set w to ""',
    "-e", "end try",
    "-e", "end tell",
    "-e", "return n & linefeed & w",
  ]).catch(() => "");
  const [app, title] = out.trim().split("\n");
  return app ? `Frontmost app: ${app}${title ? `, window "${title}"` : ""}.` : "";
}

/** Bring an app to the front (launching it if needed) so the keys go to it. */
async function focusApp(app: string | null) {
  if (!app) return;
  await exec("open", ["-a", app]).catch(() => {
    throw new Error(`No app named "${app}" on this Mac.`);
  });
  await sleep(1200);
}

async function afterKeys(dotId: string, did: string): Promise<string> {
  await sleep(700);
  await screenshot(dotId).catch(() => {});
  return [did, await frontWindow()].filter(Boolean).join(" ");
}

export async function pressKeys(dotId: string, app: string | null, combo: string): Promise<string> {
  const keys = combo.split("+").map((k) => k.trim()).filter(Boolean);
  const main = keys.find((k) => !MODS[k.toUpperCase()]);
  if (!main || (main.length > 1 && KEY_CODES[main.toUpperCase()] === undefined))
    return `Can't press "${combo}". Use modifiers (cmd, ctrl, alt, shift) plus one character or one of: ${Object.keys(KEY_CODES).join(", ").toLowerCase()}.`;
  await focusApp(app);
  try {
    await keypress(keys);
  } catch (err) {
    throw new Error(`Couldn't press keys (${err instanceof Error ? err.message : String(err)}). ${ACCESS_HINT}`);
  }
  return afterKeys(dotId, `Pressed ${keys.join("+")}.`);
}

export async function typeKeys(dotId: string, app: string | null, text: string, enter: boolean): Promise<string> {
  await focusApp(app);
  try {
    await exec("osascript", ["-e", "on run argv", "-e", 'tell application "System Events" to keystroke (item 1 of argv)', "-e", "end run", "--", text]);
    if (enter) {
      await sleep(250);
      await keypress(["return"]);
    }
  } catch (err) {
    throw new Error(`Couldn't type (${err instanceof Error ? err.message : String(err)}). ${ACCESS_HINT}`);
  }
  return afterKeys(dotId, enter ? "Typed the text and pressed Enter." : "Typed the text.");
}

export async function doAction(_dotId: string, action: ComputerAction): Promise<void> {
  switch (action.type) {
    case "click": {
      if (action.button === "back") return keypress(["cmd", "["]);
      if (action.button === "forward") return keypress(["cmd", "]"]);
      await mouse(click(action.x, action.y), action.button === "right" ? 1 : action.button === "wheel" ? 2 : 0);
      break;
    }
    case "double_click":
      await mouse(click(action.x, action.y, 2));
      break;
    case "drag": {
      const [first, ...rest] = action.path;
      if (!first) break;
      const last = rest.at(-1) ?? first;
      await mouse([
        { k: "move", ...at(first.x, first.y) },
        { k: "down", ...at(first.x, first.y) },
        ...rest.map((q): Step => ({ k: "drag", ...at(q.x, q.y) })),
        { k: "up", ...at(last.x, last.y) },
      ]);
      break;
    }
    case "move":
      await mouse([{ k: "move", ...at(action.x, action.y) }]);
      break;
    case "scroll":
      await mouse([{ k: "move", ...at(action.x, action.y) }, { k: "scroll", dx: -Math.round(action.scroll_x), dy: -Math.round(action.scroll_y) }]);
      break;
    case "keypress":
      await keypress(action.keys);
      break;
    case "type":
      await exec("osascript", ["-e", "on run argv", "-e", 'tell application "System Events" to keystroke (item 1 of argv)', "-e", "end run", "--", action.text]);
      break;
    case "wait":
      await sleep(2000);
      break;
    case "screenshot":
      break;
  }
  await sleep(350);
}
