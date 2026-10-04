export interface DesktopConfig {
  appName: string;
  version: string;
  port: number;
  dataDir: string;
  isPackaged: boolean;
  platform: "darwin" | "linux" | "win32";
}

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface NativeDialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: NativeDialogFilter[];
  properties?: Array<"openFile" | "openDirectory" | "multiSelections" | "showHiddenFiles">;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: NativeDialogFilter[];
}

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  silent?: boolean;
}

export type DesktopRPCRequest =
  | { type: "window:minimize" }
  | { type: "window:maximize" }
  | { type: "window:close" }
  | { type: "window:setAlwaysOnTop"; alwaysOnTop: boolean }
  | { type: "window:toggleFullScreen" }
  | { type: "system:getInfo" }
  | { type: "system:notify"; payload: NotificationOptions }
  | { type: "dialog:openFile"; options?: OpenDialogOptions }
  | { type: "dialog:saveFile"; options?: SaveDialogOptions }
  | { type: "app:quit" };

export type DesktopRPCResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };
