export {};

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop: true;
      platform: string;
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<void>;
      onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
    };
  }
}
