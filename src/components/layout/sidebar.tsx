"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, CheckCircle2, Wallet, FlaskConical, FileText, ClipboardList, Landmark, Truck, PackageCheck, BookOpen, Webhook, Warehouse, X, PlusCircle, SendHorizontal, Mail, DollarSign, Users, Stamp } from "lucide-react";
import { NAV_GROUPS } from "@/data/enums";
import { cn } from "@/lib/utils";

const ICONS = { LayoutDashboard, Package, CheckCircle2, Wallet, FlaskConical, FileText, ClipboardList, Landmark, Truck, PackageCheck, BookOpen, Webhook, Warehouse, PlusCircle, SendHorizontal, Mail, DollarSign, Users, Stamp } as const;
// FileText is already imported and used

// The sidebar is a fixed dark surface regardless of the (light) app theme.
function Brand() {
  return (
    <div className="flex items-center gap-2 px-5 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">1S</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-white">1Source Ops</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Fulfilment · Mode 4</div>
      </div>
    </div>
  );
}

// Orders Overview lives at the root path, and an order's own pages hang off two other
// prefixes — keep the nav item lit while you're inside one of them.
const ORDER_PROCESSING_ROUTES = ["/fulfilment/order-flow", "/fulfilment/orders"];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
      {NAV_GROUPS.map((g, gi) => (
        <div key={g.group ?? "root"} className={cn(gi > 0 && "mt-3")}>
          {g.group && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</div>}
          {g.items.map((item) => {
            const Icon = ICONS[item.icon as keyof typeof ICONS];
            const active = item.href === "/fulfilment"
              ? pathname === "/fulfilment" || ORDER_PROCESSING_ROUTES.some((r) => pathname.startsWith(r))
              : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} onClick={onNavigate}
                className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                  active ? "bg-white/10 font-semibold text-white" : "font-medium text-slate-400 hover:bg-white/5 hover:text-white")}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200 md:flex">
        <Brand />
        <NavList />
        <div className="px-5 py-4 text-[10px] leading-relaxed text-slate-500">Internal ops &amp; management console · POC · dummy data</div>
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900 text-slate-200 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <NavList onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
