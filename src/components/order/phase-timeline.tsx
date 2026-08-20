// Shared between the read-only Order Overview ("Timeline" section, order-flow-page.tsx) and the
// acting workspace's "Timeline" tab (order-workspace.tsx) — one render of the 6-phase fulfilment
// clock, so both surfaces always show the same thing.
import type { OrderBundle } from "@/types";
import { orderPhaseTimings, daysBetween, type PhaseTiming } from "@/store/selectors";
import { DurationBar, Pill, StatusPill } from "@/components/ui/primitives";

export function PhaseTimelineList({ b }: { b: OrderBundle }) {
  const timings = orderPhaseTimings(b);
  return (
    <div className="space-y-2">
      {timings.map((t) => <PhaseTimelineRow key={t.phase} t={t} />)}
    </div>
  );
}

function PhaseTimelineRow({ t }: { t: PhaseTiming }) {
  const elapsedDays = t.startedAt && t.actualDays == null ? daysBetween(t.startedAt) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
      <span className="w-40 shrink-0 text-sm font-medium">{t.label}</span>
      <DurationBar estimatedDays={t.estimatedDays} actualDays={t.actualDays} elapsedDays={elapsedDays} className="min-w-[160px] flex-1" />
      <span className="w-36 shrink-0 text-right text-xs tnum text-muted-foreground">
        {t.status === "skipped" ? "n/a"
          : t.actualDays != null ? `${t.actualDays}d / est ${t.estimatedDays}d`
          : elapsedDays != null ? `${elapsedDays}d so far / est ${t.estimatedDays}d`
          : `est ${t.estimatedDays}d`}
      </span>
      <StatusPill status={t.status} />
      {t.atRisk && <Pill tone="bad" title={t.atRisk.reason}>action needed</Pill>}
    </div>
  );
}
