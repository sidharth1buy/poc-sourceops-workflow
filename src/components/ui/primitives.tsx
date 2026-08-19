import * as React from "react";
import { cn } from "@/lib/utils";
import { toneClass, statusTone, prettyStatus, type Tone } from "@/data/enums";

// Standard page header — title + description + right-aligned actions. Used on every page.
export function PageHeader({
  title, description, actions,
}: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// Tab bar for sectioned forms. A tab shows a warning dot when it still has missing required fields.
export function FormTabBar<T extends string>({
  tabs, active, onChange,
}: { tabs: { id: T; label: string; invalid?: boolean }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)}
          className={cn("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm transition",
            active === t.id
              ? "border-primary bg-accent-soft font-semibold text-primary shadow-sm"
              : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {t.label}
          {t.invalid && <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-label="needs attention" />}
        </button>
      ))}
    </div>
  );
}

// Sticky action bar pinned to the bottom of a form (offset past the sidebar on desktop).
export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/90 backdrop-blur md:left-60">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-3">{children}</div>
    </div>
  );
}

export function Panel({
  title, actions, children, className,
}: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius)] border bg-card shadow-sm", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Pill({
  children, tone = "neutral", className, title,
}: { children: React.ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span title={title}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status?: string }) {
  return <Pill tone={statusTone(status)}>{prettyStatus(status)}</Pill>;
}

export function KpiCard({
  label, value, hint, tone = "neutral",
}: { label: string; value: React.ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tnum">{value}</span>
        {hint && <Pill tone={tone} className="text-[10px]">{hint}</Pill>}
      </div>
    </div>
  );
}

type Variant = "default" | "outline" | "ghost" | "subtle";
export function Button({
  variant = "default", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    default: "bg-primary text-primary-foreground hover:brightness-110",
    outline: "border bg-card hover:border-primary hover:text-primary",
    ghost: "hover:bg-muted",
    subtle: "bg-muted text-foreground hover:brightness-95",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        styles[variant], className,
      )}
      {...props}
    />
  );
}

/**
 * Inline notice — an alert that belongs *inside* a panel rather than as a toast: a
 * reconciliation flag, an SLA breach, an unpaid fee. `action` is the one thing to do about
 * it (omitted on read-only surfaces, where the notice states the problem and the acting
 * screen fixes it).
 */
export function Notice({
  tone, icon, action, children,
}: {
  tone: "warn" | "bad" | "info" | "ok";
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const bg = tone === "bad" ? "border-[color-mix(in_srgb,var(--bad)_40%,transparent)] bg-bad-bg text-bad"
    : tone === "warn" ? "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg text-warn"
    : tone === "ok" ? "border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-ok-bg text-ok"
    : "border-primary/40 bg-accent-soft text-primary";
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs", bg)}>
      <span className="inline-flex items-start gap-1.5">{icon}<span>{children}</span></span>
      {action}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tnum">{children}</span>
    </div>
  );
}

export type Col<T> = {
  key: string;
  header: string;
  align?: "right" | "center";
  className?: string;
  render: (row: T) => React.ReactNode;
};

/**
 * Optional grouping/emphasis props (all default to the plain table):
 * - `sectionOf` labels a row's band; when the label changes between consecutive rows a subhead
 *   row is inserted, which is how a single ordered table shows "these first, those after"
 *   (e.g. the Payments board's pending-then-settled ledgers) without splitting into two tables.
 * - `rowMuted` dims a row that is a record rather than work — same data, less ink.
 */
export function DataTable<T>({
  columns, rows, empty = "Nothing here yet.", onRowClick, isExpanded, renderExpanded, sectionOf, rowMuted,
}: { columns: Col<T>[]; rows: T[]; empty?: string; onRowClick?: (row: T) => void; isExpanded?: (row: T) => boolean; renderExpanded?: (row: T) => React.ReactNode; sectionOf?: (row: T) => string | null; rowMuted?: (row: T) => boolean }) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="no-scrollbar overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-card-2">
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
                c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              {sectionOf && sectionOf(row) && sectionOf(row) !== (i > 0 ? sectionOf(rows[i - 1]) : null) && (
                <tr className="border-b bg-muted/40">
                  <td colSpan={columns.length} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {sectionOf(row)}
                  </td>
                </tr>
              )}
              <tr
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(!(isExpanded?.(row)) && "border-b last:border-0", onRowClick && "cursor-pointer hover:bg-muted/60", isExpanded?.(row) && "bg-muted/40",
                  rowMuted?.(row) && "text-muted-foreground")}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-middle",
                    c.align === "right" && "text-right tnum", c.align === "center" && "text-center", c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
              {isExpanded?.(row) && renderExpanded && (
                <tr className="border-b last:border-0">
                  <td colSpan={columns.length} className="bg-muted/20 px-3 pb-3">{renderExpanded(row)}</td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Numbered pager for tables with more rows than fit on one page. Collapses
// distant page numbers into an ellipsis, always keeping first/last/current±1
// visible. Slicing the row array by page is the caller's job (see the Escrow
// board) — this component only renders the control and reports the click.
export function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }

  return (
    <div className="mt-3 flex items-center justify-end gap-1">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page === 1}
        className="rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        ← Prev
      </button>
      {pages.map((p, i) => p === "…"
        ? <span key={`e${i}`} className="px-1.5 text-xs text-faint">…</span>
        : (
          <button key={p} type="button" onClick={() => onChange(p)}
            className={cn("min-w-[1.75rem] rounded-lg border px-2 py-1 text-xs font-medium transition",
              p === page ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground hover:text-foreground")}>
            {p}
          </button>
        ))}
      <button type="button" onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-40">
        Next →
      </button>
    </div>
  );
}

export { statusTone };
