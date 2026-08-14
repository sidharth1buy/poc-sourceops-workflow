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

export function DataTable<T>({
  columns, rows, empty = "Nothing here yet.", onRowClick,
}: { columns: Col<T>[]; rows: T[]; empty?: string; onRowClick?: (row: T) => void }) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="no-scrollbar overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-card-2">
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                c.align === "right" && "text-right", c.align === "center" && "text-center")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("border-b last:border-0", onRowClick && "cursor-pointer hover:bg-muted/60")}>
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2.5 align-middle",
                  c.align === "right" && "text-right tnum", c.align === "center" && "text-center", c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { statusTone };
