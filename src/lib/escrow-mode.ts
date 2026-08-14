"use client";

import { useSyncExternalStore } from "react";

// Demo-reliability toggle: lets a presenter flip Escrow over to a pure
// client-side simulation (src/integrations/escrow-mock.ts) when the real
// escrow-agents backend isn't reachable — see src/lib/escrow-api.ts.
export const ESCROW_MOCK_STORAGE_KEY = "poc-escrow-mock";
export const ESCROW_MOCK_CHANGE_EVENT = "poc-escrow-mock-change";

export function setEscrowMockMode(on: boolean) {
  localStorage.setItem(ESCROW_MOCK_STORAGE_KEY, on ? "true" : "false");
  window.dispatchEvent(new CustomEvent(ESCROW_MOCK_CHANGE_EVENT, { detail: on }));
}

export function isEscrowMockMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ESCROW_MOCK_STORAGE_KEY) === "true";
}

const subscribe = (cb: () => void) => {
  window.addEventListener(ESCROW_MOCK_CHANGE_EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => { window.removeEventListener(ESCROW_MOCK_CHANGE_EVENT, cb); window.removeEventListener("storage", cb); };
};

export function useEscrowMockMode(): boolean {
  return useSyncExternalStore(subscribe, isEscrowMockMode, () => false);
}
