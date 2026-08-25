"use client";

import type { OrderBundle, Lot } from "@/types";
import { LAB_TERMS_LABEL, LAB_TERMS_TONE, LAB_TERMS_HINT } from "@/data/enums";
import { Pill } from "@/components/ui/primitives";
import { TestingStageChain } from "@/components/order/testing-stages";
import { MpnFeeStrip } from "@/components/order/test-tables";
import { ReportRepository } from "@/components/order/report-repository";
import { specForMpn, mpnFeeRollup } from "@/store/selectors";
import { qtyfmt, cn } from "@/lib/utils";

/**
 * The read-only rendering of one lot on the order-flow page: where the lot is, and the report.
 *
 * Deliberately just those two. A vertical stage list was cut because the lifecycle chain above
 * it already names every stage with its date, and the per-test table was cut because the report
 * — readable on screen and downloadable here — is the answer that table was approximating.
 * Anyone who needs the per-test tracker, the MPN requirements or the mail thread wants the
 * acting screen, which is one link away.
 *
 * Read-only means no control that *changes the order*: no mail, no stage moves, no verdicts,
 * no fee settlement. Opening and downloading a report is not in that set — it's the document
 * this page exists to show — and both are access-logged wherever they happen.
 */

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{text}</div>;
}

/** One lot opened out: where it is, and the report — parsed on screen and downloadable. */
export function LotReadOnlyDetail({
  orderId, lot,
}: { orderId: string; lot: Lot }) {
  return (
    <div className="space-y-3">
      {/* where the lot physically is — every stage, with the date each was established */}
      <TestingStageChain orderId={orderId} lot={lot} canEdit={false} readOnly />

      {/* the result itself: conclusion, the parsed header, open + download (access-logged) */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Test result &amp; report
        </div>
        <ReportRepository orderId={orderId} lot={lot} readOnly />
      </div>
    </div>
  );
}

/** What each MPN has to be tested for, and what the lab charges for that list. */
export function MpnRequirements({ b }: { b: OrderBundle }) {
  if (b.lines.length === 0) return <Empty text="No order lines." />;
  return (
    <div className="space-y-2">
      {b.lines.map((line) => {
        const spec = specForMpn(b, line.mpn);
        const lots = b.lots.filter((l) => l.orderLineMpn === line.mpn);
        const fee = mpnFeeRollup(b, line.mpn);
        return (
          <div key={line.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{line.mpn}</span>
              <Pill tone={line.testingMode === "NONE" ? "neutral" : "info"}>{line.testingMode}</Pill>
              <span className="text-xs text-faint">{line.make} · qty {qtyfmt(line.quantity)} · {lots.length} lot(s)</span>
              {!spec ? <Pill tone="warn">not parsed</Pill>
                : spec.autofill === "FAILED" ? <Pill tone="bad">auto-fill failed</Pill>
                : <Pill tone="ok">auto-filled</Pill>}
              {spec && <span className="text-xs text-muted-foreground tnum">{spec.tests.length} test(s)</span>}
              {fee.terms.length === 1 && (
                <Pill tone={LAB_TERMS_TONE[fee.terms[0]]} title={LAB_TERMS_HINT[fee.terms[0]]}>{LAB_TERMS_LABEL[fee.terms[0]]}</Pill>
              )}
            </div>
            {spec && spec.tests.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spec.tests.map((t) => (
                  <Pill key={t.id} tone={t.source === "MANUAL" ? "warn" : "neutral"}
                    title={t.source === "MANUAL" ? "added manually — logged as an override" : "parsed off the PO"}>
                    {t.name}{t.standard ? ` · ${t.standard}` : ""}
                  </Pill>
                ))}
              </div>
            )}
            {spec && (
              <div className={cn("mt-1.5 text-[11px] text-faint")}>
                source: {spec.sourceDoc ?? "—"} · parsed {spec.parsedAt ?? "—"}
                {spec.confidence !== undefined && ` · confidence ${Math.round(spec.confidence * 100)}%`}
                {spec.audit.length > 0 && ` · ${spec.audit.length} logged change(s)`}
              </div>
            )}
            <div className="mt-1.5"><MpnFeeStrip b={b} mpn={line.mpn} /></div>
          </div>
        );
      })}
    </div>
  );
}
