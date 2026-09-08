// The browser adapter is an OPTIONAL dependency loaded by dynamic import (ADR-007).
// This ambient declaration keeps the core engine type-checkable without installing it.
declare module 'playwright' {
  export const chromium: any;
}
