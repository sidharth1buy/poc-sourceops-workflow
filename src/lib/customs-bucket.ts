// Coarse customs-clearance buckets — the granular ICEGATE stages (file → IGM → assess → duty → OOC)
// collapsed into the practical states a customs/finance team watches, matching the real India import
// flow: declaration (BoE) → assessment → duty payment → Out of Charge.
import type { CustomsEntry } from "@/types";
import type { Tone } from "@/data/enums";

export type CustomsBucket = "NEW" | "FILED" | "PENDING_PAYMENT" | "PAID" | "CLEARED";

export function customsBucket(c: CustomsEntry): CustomsBucket {
  const filed = !!c.beNo && c.beNo !== "filing…";
  if (!filed) return "NEW";
  if (c.icegateRef || c.stage === "CLEARED") return "CLEARED";
  if (c.dutyPaidAt || c.stage === "DUTY_PAID") return "PAID";
  if (c.duty || c.stage === "ASSESSED") return "PENDING_PAYMENT";
  return "FILED"; // filed, awaiting assessment
}

export const BUCKET_META: Record<CustomsBucket, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "warn" },
  FILED: { label: "Filed", tone: "info" },
  PENDING_PAYMENT: { label: "Pending payment", tone: "warn" },
  PAID: { label: "Paid", tone: "info" },
  CLEARED: { label: "Cleared", tone: "ok" },
};

export const BUCKET_ORDER: CustomsBucket[] = ["NEW", "FILED", "PENDING_PAYMENT", "PAID", "CLEARED"];
