// Core shipment stages — raw carrier statuses (+ pickup / booking signals) grouped into the
// pipeline a logistics team actually watches. Modelled on how AfterShip / ShipStation / project44
// collapse many carrier checkpoints into a handful of stages, with Exception kept as its own bucket.
import type { Shipment } from "@/types";

export type ShipmentStage =
  | "BOOKED" | "PICKUP" | "PICKED_UP" | "IN_TRANSIT" | "AT_CUSTOMS" | "DELIVERED" | "EXCEPTION";

export function shipmentStage(s: Pick<Shipment, "status" | "awb" | "pickupConfirmationNo">): ShipmentStage {
  if (s.awb === "booking failed" || s.status === "CANCELLED") return "EXCEPTION";
  switch (s.status) {
    case "DISPATCHED": return "PICKED_UP";
    case "IN_TRANSIT": return "IN_TRANSIT";
    case "AT_CUSTOMS": return "AT_CUSTOMS";
    case "ARRIVED":
    case "DELIVERED": return "DELIVERED";
    case "PLANNED":
    default: return s.pickupConfirmationNo ? "PICKUP" : "BOOKED";
  }
}

export type StageTone = "neutral" | "info" | "warn" | "ok" | "bad";
export const STAGE_META: Record<ShipmentStage, { label: string; tone: StageTone }> = {
  BOOKED: { label: "Booked", tone: "neutral" },
  PICKUP: { label: "Pickup scheduled", tone: "info" },
  PICKED_UP: { label: "Picked up", tone: "info" },
  IN_TRANSIT: { label: "In transit", tone: "info" },
  AT_CUSTOMS: { label: "In customs", tone: "warn" },
  DELIVERED: { label: "Delivered", tone: "ok" },
  EXCEPTION: { label: "Exception", tone: "bad" },
};

// display order for the filter bar / pipeline
export const STAGE_ORDER: ShipmentStage[] = ["BOOKED", "PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_CUSTOMS", "DELIVERED", "EXCEPTION"];
