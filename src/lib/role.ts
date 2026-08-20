"use client";

import { useSyncExternalStore } from "react";
import {
  ROLES, TEST_EDIT_ROLES, LAB_EMAIL_ROLES, ESCROW_ACCESS_ROLES, PAYMENTS_ACCESS_ROLES,
  TESTING_ACCESS_ROLES, SALES_ORDER_ACCESS_ROLES, PURCHASE_ORDER_ACCESS_ROLES, type Role,
} from "@/data/enums";

export const ROLE_STORAGE_KEY = "poc-role";
export const ROLE_CHANGE_EVENT = "poc-role-change";

/** Persist the active persona and tell every listening component (same tab included). */
export function setActiveRole(r: Role) {
  localStorage.setItem(ROLE_STORAGE_KEY, r);
  window.dispatchEvent(new CustomEvent(ROLE_CHANGE_EVENT, { detail: r }));
}

const read = (): Role => {
  const r = typeof window === "undefined" ? null : (localStorage.getItem(ROLE_STORAGE_KEY) as Role | null);
  return r && (ROLES as readonly string[]).includes(r) ? r : "SC";
};

// localStorage is an external store — subscribe to it rather than mirroring it into state.
const subscribe = (cb: () => void) => {
  window.addEventListener(ROLE_CHANGE_EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => { window.removeEventListener(ROLE_CHANGE_EVENT, cb); window.removeEventListener("storage", cb); };
};

/**
 * Active persona + what it's allowed to do. The POC has no real auth, but the
 * permission seam is real: gating happens here, not inline in components.
 */
export function useRole() {
  const role = useSyncExternalStore(subscribe, read, () => "SC" as Role);

  return {
    role,
    canEditTests: TEST_EDIT_ROLES.includes(role),
    canEmailLab: LAB_EMAIL_ROLES.includes(role),
    canAccessEscrow: ESCROW_ACCESS_ROLES.includes(role),
    canAccessPayments: PAYMENTS_ACCESS_ROLES.includes(role),
    canAccessTesting: TESTING_ACCESS_ROLES.includes(role),
    canAccessSalesOrders: SALES_ORDER_ACCESS_ROLES.includes(role),
    canAccessPurchaseOrders: PURCHASE_ORDER_ACCESS_ROLES.includes(role),
  };
}
