import type { ElectrobunConfig } from "electrobun";

export const config: ElectrobunConfig = {
  app: {
    name: "Ditto",
    id: "com.ditto.desktop",
    version: "0.1.0",
  },
  build: {
    mac: {
      bundleId: "com.ditto.desktop",
      category: "productivity",
      entitlements: {
        "com.apple.security.network.client": true,
        "com.apple.security.network.server": true,
        "com.apple.security.device.microphone": true,
        "com.apple.security.device.camera": true,
      },
    },
    linux: {
      category: "Utility",
    },
    win: {
      category: "Productivity",
    },
  },
  window: {
    title: "Ditto",
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: "hiddenInset",
    url: "http://127.0.0.1:3100",
  },
};

export default config;
