import type { SoostaApi } from './shared/types';

declare global {
  interface Window {
    soosta: SoostaApi;
  }
}

export {};
