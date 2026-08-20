"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { EscrowTab } from "@/components/order/escrow-tab";
import { UploadEscrowInvoiceModal, UploadPaymentClosureModal, UploadDocModal, UploadPIModal } from "@/components/order/modals";
import { Panel, Pill, StatusPill, RoleLocked } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { useRole } from "@/lib/role";
import { useEscrowMockMode } from "@/lib/escrow-mode";

type ModalKey = null | "escrowInvoice" | "paymentClosure" | "doc" | "pi";

// Escrow order handling is run by Supply Chain, and lives only here (not as an
// order-workspace tab) — see ESCROW_ACCESS_ROLES in @/data/enums.
export function EscrowOrderDetail({ id }: { id: string }) {
  const b = useStore((s) => s.orders[id]);
  const { canAccessEscrow } = useRole();
  const escrowMock = useEscrowMockMode();
  const [modal, setModal] = useState<ModalKey>(null);
  const close = () => setModal(null);

  if (!canAccessEscrow) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment/escrow" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Escrow board</Link>
        <Panel><RoleLocked roleLabel="SC" action="view or act on this order's escrow" /></Panel>
      </div>
    );
  }

  if (!b) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment/escrow" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Escrow board</Link>
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">Order not found (it may have been reset). <Link href="/fulfilment/escrow" className="text-primary hover:underline">Back to the Escrow board</Link>.</div></Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/fulfilment/escrow" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Escrow board</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-semibold">{b.orderNo}</h1>
          <p className="text-sm text-muted-foreground">{b.buyer.name} · {b.supplier.name}</p>
        </div>
        {escrowMock && <Pill tone="warn">Mock mode</Pill>}
        {b.escrow && <StatusPill status={b.escrow.status} />}
      </div>

      <EscrowTab
        b={b} id={id}
        onUploadInvoice={() => setModal("escrowInvoice")}
        onUploadPaymentClosure={() => setModal("paymentClosure")}
        onUploadPI={() => setModal("pi")}
        onUploadDoc={() => setModal("doc")}
      />

      {modal === "escrowInvoice" && <UploadEscrowInvoiceModal orderId={id} onClose={close} />}
      {modal === "paymentClosure" && <UploadPaymentClosureModal orderId={id} onClose={close} />}
      {modal === "doc" && <UploadDocModal orderId={id} onClose={close} />}
      {modal === "pi" && <UploadPIModal orderId={id} onClose={close} />}
    </div>
  );
}
