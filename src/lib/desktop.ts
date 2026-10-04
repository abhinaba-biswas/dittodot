"use client";

import { useEffect, useState } from "react";
import { isDesktopApp, getDesktopPlatform, desktop } from "@/desktop/bridge";

export function useDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [platform, setPlatform] = useState<"darwin" | "linux" | "win32" | "web">("web");

  useEffect(() => {
    setIsDesktop(isDesktopApp());
    setPlatform(getDesktopPlatform());
  }, []);

  return {
    isDesktop,
    platform,
    desktop,
  };
}
