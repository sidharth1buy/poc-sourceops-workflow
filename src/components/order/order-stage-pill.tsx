import { Pill } from "@/components/ui/primitives";
import { currentOrderStage } from "@/store/selectors";
import type { OrderBundle } from "@/types";

// Which step the order is on right now, distinct from its formal OrderStatus (shown separately
// via StatusPill — Active/On Hold/Closed/Cancelled). Renders nothing once there's no current step
// (order closed/cancelled) since StatusPill next to it already says so.
export function OrderStagePill({ b }: { b: OrderBundle }) {
  const stage = currentOrderStage(b);
  if (!stage.stepName) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {stage.blocked ? <Pill tone="bad">Blocked</Pill> : <Pill tone="active">On track</Pill>}
      <span className="max-w-[140px] truncate text-xs text-muted-foreground" title={stage.blocked ?? stage.stepName}>{stage.stepName}</span>
    </span>
  );
}
