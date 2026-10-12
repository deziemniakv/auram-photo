/// <reference types="vite/client" />
import type { PhotoApi } from '../../shared/ipc';

declare global {
  interface Window {
    readonly auramPhoto?: PhotoApi;
  }
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
