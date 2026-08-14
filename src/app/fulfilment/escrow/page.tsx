"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useStore } from "@/store/store";
import { allEscrow } from "@/store/selectors";
import { Panel, Pill, StatusPill, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { money } from "@/lib/utils";
import { useRole } from "@/lib/role";
import { useEscrowMockMode } from "@/lib/escrow-mode";

export default function EscrowBoardPage() {
  const orders = useStore((s) => s.orders);
  const { canAccessEscrow } = useRole();
  const escrowMock = useEscrowMockMode();
  const rows = allEscrow(orders);
  const title = <span className="inline-flex items-center gap-2">Escrow board{escrowMock && <Pill tone="warn">Mock mode</Pill>}</span>;

  const cols: Col<(typeof rows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/escrow/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "buyer", header: "Buyer", render: (r) => r.e.buyerContact.company },
    { key: "seller", header: "Seller", render: (r) => r.e.sellerContact.company },
    { key: "inv", header: "Invoice no.", render: (r) => <span className="font-mono text-xs">{r.e.invoice?.invoiceNo ?? "—"}</span> },
    { key: "amt", header: "PO amount", align: "right", render: (r) => money(r.e.poAmount, r.e.currency) },
    { key: "status", header: "Status", render: (r) => r.e.cancelledAt ? <Pill tone="bad">Cancelled</Pill> : <StatusPill status={r.e.status} /> },
    { key: "act", header: "", align: "right", render: (r) => <Link href={`/fulfilment/escrow/${r.orderId}`} className="text-xs font-medium text-primary hover:underline">Open →</Link> },
  ];

  if (!canAccessEscrow) {
    return (
      <div className="space-y-5">
        <PageHeader title="Escrow board" description="Escrow moves real money — restricted to Finance." />
        <Panel>
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Lock className="mx-auto mb-2 h-5 w-5 text-warn" />
            Escrow is Finance-only. Switch to the Finance persona (top right) to view or act on escrow orders.
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={title} description="Every order's escrow order across the 8-state HKin-modelled flow (Draft → Released to Seller). All actions — advance, invoice, accept/reject, release, refund — live here on each order's detail page." />
      <Panel><DataTable columns={cols} rows={rows} empty="No escrow orders." /></Panel>
    </div>
  );
}
