"use client";
/* eslint-disable react-hooks/set-state-in-effect -- POC: hydrate persisted theme/role on mount */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Plus, RotateCcw, Menu } from "lucide-react";
import { ROLES, type Role } from "@/data/enums";
import { setActiveRole, ROLE_STORAGE_KEY } from "@/lib/role";
import { useEscrowMockMode, setEscrowMockMode } from "@/lib/escrow-mode";
import { Button } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { cn } from "@/lib/utils";

const ROLE_HOME: Record<Role, string> = {
  SC: "/fulfilment/orders",
  Finance: "/fulfilment/payments",
  Approver: "/fulfilment/approvals",
  Mgmt: "/fulfilment",
};

export function Header({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("SC");
  const resetDemo = useStore((s) => s.resetDemo);
  const [createOpen, setCreateOpen] = useState(false);
  const escrowMock = useEscrowMockMode();

  useEffect(() => {
    document.documentElement.classList.remove("dark"); // POC is light-theme only
    const r = localStorage.getItem(ROLE_STORAGE_KEY) as Role | null;
    if (r) setRole(r);
  }, []);

  function pickRole(r: Role) {
    setRole(r);
    setActiveRole(r); // persists + notifies permission-gated screens (e.g. WHL testing)
    router.push(ROLE_HOME[r]);
  }

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/85 px-4 py-3 backdrop-blur sm:px-6">
      <button onClick={onMenu} aria-label="Open menu" className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background md:hidden">
        <Menu className="h-4 w-4" />
      </button>
      <div className="relative hidden max-w-sm flex-1 items-center sm:flex">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-faint" />
        <input placeholder="Search orders, AWB, BOE…" className="w-full rounded-lg border bg-background py-1.5 pl-9 pr-3 text-sm outline-none focus:border-primary" />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setEscrowMockMode(!escrowMock)}
          title="Escrow backend — Live hits the real escrow-agents server; Mock simulates it locally for demos when that server isn't reachable"
          className={cn(
            "hidden rounded-lg border px-2.5 py-1 text-xs font-medium transition md:block",
            escrowMock ? "border-warn bg-warn-bg text-warn" : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          Escrow: {escrowMock ? "Mock" : "Live"}
        </button>
        <div className="hidden items-center gap-1 rounded-lg border bg-background p-0.5 text-xs md:flex" title="Persona — jumps to that role's work queue">
          {ROLES.map((r) => (
            <button key={r} onClick={() => pickRole(r)}
              className={cn("rounded-md px-2.5 py-1 font-medium transition", role === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{r}</button>
          ))}
        </div>
        <button onClick={() => { if (confirm("Reset all demo data to the seeded state?")) resetDemo(); }} aria-label="Reset demo"
          className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background hover:border-primary" title="Reset demo data">
          <RotateCcw className="h-4 w-4" />
        </button>
        <div className="relative">
          <Button onClick={() => setCreateOpen((o) => !o)}><Plus className="h-4 w-4" /> Create</Button>
          {createOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setCreateOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border bg-card p-1 shadow-xl">
                <Link href="/fulfilment/client-pos/new" onClick={() => setCreateOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-muted"><b>1 ·</b> New Sales Order <span className="text-faint">(demand)</span></Link>
                <Link href="/fulfilment/supplier-pos/new" onClick={() => setCreateOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-muted"><b>2 ·</b> New Purchase Order <span className="text-faint">(our purchase doc)</span></Link>
                <Link href="/fulfilment/supplier-pos" onClick={() => setCreateOpen(false)} className="block rounded-md px-3 py-2 text-sm hover:bg-muted"><b>3 ·</b> Order <span className="text-faint">(from a Purchase Order)</span></Link>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
