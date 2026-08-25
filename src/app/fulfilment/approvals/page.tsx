"use client";

import Link from "next/link";
import { useStore } from "@/store/store";
import { allApprovals } from "@/store/selectors";
import { Panel, Button, StatusPill, Pill, PageHeader } from "@/components/ui/primitives";

export default function ApprovalsPage() {
  const orders = useStore((s) => s.orders);
  const decide = useStore((s) => s.decideApproval);
  const items = allApprovals(orders);
  const pending = items.filter((a) => a.status === "PENDING");
  const decided = items.filter((a) => a.status !== "PENDING");

  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" description={<>Finance / Sales gate — PO reviews & payment releases. {pending.length} pending.</>} />
      <Panel title="Pending">
        {pending.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing to approve 🎉</div> : (
          <div className="space-y-2">
            {pending.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Pill tone={a.kind === "PO_REVIEW" ? "info" : "warn"}>{a.kind.replace(/_/g, " ")}</Pill>
                    <Link href={`/fulfilment/order-flow/${a.orderId}`} className="font-mono text-xs text-primary hover:underline">{a.orderNo}</Link>
                  </div>
                  <div className="text-xs text-muted-foreground">{a.party} · role {a.role}{a.notes ? ` · ${a.notes}` : ""}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => decide(a.orderId, a.id, "REJECTED")}>Reject</Button>
                  <Button onClick={() => decide(a.orderId, a.id, "APPROVED")}>Approve</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {decided.length > 0 && (
        <Panel title="Recently decided">
          <div className="space-y-2">
            {decided.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <span><Link href={`/fulfilment/order-flow/${a.orderId}`} className="font-mono text-xs text-primary hover:underline">{a.orderNo}</Link> · {a.kind.replace(/_/g, " ")} · {a.party}</span>
                <StatusPill status={a.status} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
