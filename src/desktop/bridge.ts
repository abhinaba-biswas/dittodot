"use client";

import type { DesktopRPCRequest, DesktopRPCResponse, NotificationOptions, OpenDialogOptions } from "./types";

declare global {
  interface Window {
    /** Injected by Electrobun's preload into every webview. */
    __electrobunPlatform?: "macos" | "darwin" | "linux" | "win" | "win32" | string;
    __electrobun?: {
      rpc: (msg: string) => Promise<string>;
      platform: "darwin" | "linux" | "win32";
      isDesktop: boolean;
    };
  }
}

export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__electrobun?.isDesktop || process.env.NEXT_PUBLIC_DESKTOP === "true");
}

export function getDesktopPlatform(): "darwin" | "linux" | "win32" | "web" {
  if (typeof window === "undefined") return "web";
  const p = window.__electrobunPlatform ?? window.__electrobun?.platform;
  if (!p) {
    // Preload globals can lag behind first render; the window id is injected alongside the platform.
    const inApp = (window as { __electrobunWindowId?: unknown }).__electrobunWindowId !== undefined;
    return inApp && /Macintosh/.test(navigator.userAgent) ? "darwin" : "web";
  }
  if (p === "macos" || p === "darwin") return "darwin";
  if (p === "win" || p === "win32") return "win32";
  return "linux";
}

export async function sendDesktopRPC<T = unknown>(req: DesktopRPCRequest): Promise<T> {
  if (typeof window === "undefined" || !window.__electrobun?.rpc) {
    // Graceful fallback for web/dev preview
    console.debug("[desktop-rpc] Web fallback for:", req.type);
    return null as T;
  }

  try {
    const raw = await window.__electrobun.rpc(JSON.stringify(req));
    const res: DesktopRPCResponse<T> = JSON.parse(raw);
    if (!res.success) {
      throw new Error(res.error);
    }
    return res.data;
  } catch (err) {
    console.error("[desktop-rpc] Error executing RPC call:", req, err);
    throw err;
  }
}

export const desktop = {
  minimize: () => sendDesktopRPC({ type: "window:minimize" }),
  maximize: () => sendDesktopRPC({ type: "window:maximize" }),
  close: () => sendDesktopRPC({ type: "window:close" }),
  setAlwaysOnTop: (alwaysOnTop: boolean) => sendDesktopRPC({ type: "window:setAlwaysOnTop", alwaysOnTop }),
  toggleFullScreen: () => sendDesktopRPC({ type: "window:toggleFullScreen" }),
  notify: (opts: NotificationOptions) => sendDesktopRPC({ type: "system:notify", payload: opts }),
  openFile: (options?: OpenDialogOptions) => sendDesktopRPC<string[] | null>({ type: "dialog:openFile", options }),
  quit: () => sendDesktopRPC({ type: "app:quit" }),
};
