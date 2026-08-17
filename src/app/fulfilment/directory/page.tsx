"use client";

import { BUYERS, SUPPLIERS } from "@/data/directory";
import { PageHeader, Panel, DataTable, type Col } from "@/components/ui/primitives";
import type { DirectoryEntry } from "@/data/directory";

export default function DirectoryPage() {
  const buyerCols: Col<DirectoryEntry>[] = [
    { key: "name", header: "Name", render: (b) => <span className="font-medium">{b.name}</span> },
    { key: "country", header: "Country", render: (b) => <span className="text-sm text-muted-foreground">{b.country}</span> },
    { key: "email", header: "Email", render: (b) => <span className="text-xs text-primary">{b.email || "-"}</span> },
    { key: "gstin", header: "GSTIN/UIN", render: (b) => <span className="font-mono text-xs">{b.gstin || "-"}</span> },
    { key: "contact", header: "Contact", render: (b) => <span className="text-xs text-muted-foreground">{b.contact || "-"}</span> },
  ];

  const supplierCols: Col<DirectoryEntry>[] = [
    { key: "name", header: "Name", render: (s) => <span className="font-medium">{s.name}</span> },
    { key: "country", header: "Country", render: (s) => <span className="text-sm text-muted-foreground">{s.country}</span> },
    { key: "email", header: "Email", render: (s) => <span className="text-xs text-primary">{s.email || "-"}</span> },
    { key: "gstin", header: "GSTIN/UIN", render: (s) => <span className="font-mono text-xs">{s.gstin || "-"}</span> },
    { key: "contact", header: "Contact", render: (s) => <span className="text-xs text-muted-foreground">{s.contact || "-"}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Directory"
        description="Master list of buyers and suppliers available for selection in PO forms."
      />

      <Panel title={`Buyers (${BUYERS.length})`}>
        <DataTable columns={buyerCols} rows={BUYERS} />
      </Panel>

      <Panel title={`Suppliers (${SUPPLIERS.length})`}>
        <DataTable columns={supplierCols} rows={SUPPLIERS} />
      </Panel>

      <Panel title="How to use">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p><b className="text-foreground">When creating Sales Orders:</b> Select a buyer from the dropdown in the "Client & parties" tab. The buyer's details (name, GSTIN, state) will auto-fill.</p>
          <p><b className="text-foreground">When creating Purchase Orders:</b> Select a supplier from the dropdown in the "Supplier & terms" tab. The supplier's details (name, GSTIN, state) will auto-fill.</p>
          <p><b className="text-foreground">To add more:</b> Contact your administrator to add new buyers or suppliers to the master directory.</p>
        </div>
      </Panel>
    </div>
  );
}
