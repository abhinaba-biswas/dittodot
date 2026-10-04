declare module "electrobun" {
  export interface ElectrobunAppConfig {
    name: string;
    id: string;
    version: string;
  }

  export interface ElectrobunBuildConfig {
    mac?: {
      bundleId?: string;
      category?: string;
      entitlements?: Record<string, boolean | string>;
    };
    linux?: {
      category?: string;
    };
    win?: {
      category?: string;
    };
  }

  export interface ElectrobunWindowConfig {
    title?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    frame?: boolean;
    titleBarStyle?: "hidden" | "hiddenInset" | "default";
    url?: string;
    webPreferences?: {
      webgl?: boolean;
      accelerated2dCanvas?: boolean;
      experimentalFeatures?: boolean;
    };
  }

  export interface ElectrobunConfig {
    app: ElectrobunAppConfig;
    build?: ElectrobunBuildConfig;
    window?: ElectrobunWindowConfig;
  }
}

declare module "electrobun/main" {
  export interface WindowOptionsType {
    title?: string;
    url?: string | null;
    html?: string | null;
    frame?: {
      x?: number;
      y?: number;
      width: number;
      height: number;
    };
    titleBarStyle?: "hidden" | "hiddenInset" | "default";
    transparent?: boolean;
    passthrough?: boolean;
    spellCheck?: boolean;
    renderer?: "native" | "cef";
  }

  export type ApplicationMenuItem =
    | { type: "divider" | "separator" }
    | {
        type?: "normal";
        label?: string;
        role?: string;
        action?: string;
        accelerator?: string;
        enabled?: boolean;
        checked?: boolean;
        submenu?: ApplicationMenuItem[];
      };

  export const ApplicationMenu: {
    setApplicationMenu(menu: ApplicationMenuItem[]): void;
    on(name: "application-menu-clicked", handler: (event: unknown) => void): void;
  };

  export class BrowserWindow {
    constructor(options?: WindowOptionsType);
    close(): void;
    setTitle(title: string): void;
    loadURL(url: string): void;
  }
}
