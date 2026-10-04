"use client";

import { useEffect } from "react";
import { getDesktopPlatform } from "@/desktop/bridge";

type HostWindow = Window & { __electrobunSendToHost?: (message: unknown) => void; __dittoGlobalHotkey?: boolean };

/** Fired for the voice hotkey; the chat view starts or ends a call in response. */
export const VOICE_TOGGLE_EVENT = "ditto:voice-toggle";

/**
 * Desktop-only behaviour: tags <html> with desktop-mac so the CSS can clear the traffic lights, maximizes the window
 * on a title-area double-click, and routes the voice hotkey.
 */
export default function DesktopShell() {
  useEffect(() => {
    const w = window as HostWindow;
    const mac = getDesktopPlatform() === "darwin";
    if (mac) document.documentElement.classList.add("desktop-mac");

    // Double-click on a drag region (not a button or field inside it) toggles zoom.
    const onDouble = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest(".desktop-drag") || el.closest("a, button, input, textarea, select, [role='button']")) return;
      w.__electrobunSendToHost?.({ type: "window:toggleMaximize" });
    };

    // In the browser (or if the system-wide shortcut couldn't be registered) listen for the key here.
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey || e.repeat) return;
      if (w.__dittoGlobalHotkey) return; // the host already dispatches it
      e.preventDefault();
      if (Date.now() - last < 400) return;
      last = Date.now();
      window.dispatchEvent(new CustomEvent(VOICE_TOGGLE_EVENT));
    };

    if (mac) document.addEventListener("dblclick", onDouble);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.documentElement.classList.remove("desktop-mac");
      document.removeEventListener("dblclick", onDouble);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return null;
}
