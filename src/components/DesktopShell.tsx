"use client";

import { useEffect } from "react";
import { getDesktopPlatform } from "@/desktop/bridge";

/** Tags <html> with desktop-mac inside the macOS app so the CSS can clear the traffic lights and drop web-only behaviour. */
export default function DesktopShell() {
  useEffect(() => {
    if (getDesktopPlatform() !== "darwin") return;
    document.documentElement.classList.add("desktop-mac");
    return () => document.documentElement.classList.remove("desktop-mac");
  }, []);
  return null;
}
