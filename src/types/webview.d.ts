/**
 * Tipe element <webview> milik Electron untuk JSX (kustom element, bukan HTML).
 * Dipakai hanya saat app jalan dalam shell Electron; di browser biasa tidak
 * pernah dirender (branch web-view).
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          useragent?: string;
          allowpopups?: boolean;
          partition?: string;
        },
        HTMLElement
      >;
    }
  }
}

declare global {
  interface Window {
    electronApi?: { platform: string };
  }
}

export {};
