"""One-off generator for sample Client PO / Supplier PO(+PI) PDFs to use as the
literal file picked during a live demo of "New Client PO / New Supplier PO ->
Upload PO -> Parse & pre-fill". The POC's mock parser (doc-extract.ts) never
reads file content -- it always returns the same canned data regardless of
what's uploaded -- so these exist purely to make that click look real on
screen. Not committed as a runtime dependency; uses fpdf2 (already installed
in the sibling pushkar-poc-backend repo's .venv), run once:

    /Users/1buy-harsh/Desktop/POC_PUSHKAR/pushkar-poc-backend/.venv/bin/python \
        sample-docs/generate_sample_docs.py
"""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

OUT_DIR = Path(__file__).parent


def _pdf() -> FPDF:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)
    return pdf


def make_client_po() -> None:
    pdf = _pdf()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "Purchase Order", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, "PO No.: BEL/26-27/PO/0099    Dated: 05-Aug-26", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, "Buyer", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, "Bharat Defence Electronics Ltd.", ln=True)
    pdf.cell(0, 6, "GSTIN: 29AAACB1234F1Z5   State: Karnataka", ln=True)
    pdf.cell(0, 6, "Deliver to: BEL Factory, Jalahalli, Bengaluru - 560013", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(60, 6, "MPN", border=1)
    pdf.cell(45, 6, "Manufacturer", border=1)
    pdf.cell(30, 6, "Date Code", border=1)
    pdf.cell(20, 6, "Qty", border=1)
    pdf.cell(35, 6, "Unit Price (USD)", border=1, ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(60, 6, "TMS320F28379D", border=1)
    pdf.cell(45, 6, "Texas Instruments", border=1)
    pdf.cell(30, 6, "2540+", border=1)
    pdf.cell(20, 6, "800", border=1)
    pdf.cell(35, 6, "18.20", border=1, ln=True)
    pdf.cell(60, 6, "AD7768-4BSTZ", border=1)
    pdf.cell(45, 6, "Analog Devices", border=1)
    pdf.cell(30, 6, "2531+", border=1)
    pdf.cell(20, 6, "300", border=1)
    pdf.cell(35, 6, "24.60", border=1, ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Delivery terms", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.multi_cell(0, 6, "Delivered Duty Paid to Bengaluru factory gate. Lead time 5 weeks from PO acceptance.")
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Testing terms", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.multi_cell(0, 6, "Independent WHL test report required on both lines before delivery; date code 25 or later, minimum 1 year warranty.")

    pdf.output(str(OUT_DIR / "sample_client_po.pdf"))


def make_supplier_po_pi() -> None:
    pdf = _pdf()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "Proforma Invoice", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, "PI No.: SZAX-PI-2607-0221    Dated: 06-Aug-26", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(95, 6, "Seller", ln=0)
    pdf.cell(95, 6, "Buyer", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(95, 6, "Shenzhen Apex Electronics Co., Ltd.", ln=0)
    pdf.cell(95, 6, "Sharpbuy Global Solutions", ln=True)
    pdf.cell(95, 6, "Futian District, Shenzhen, China", ln=0)
    pdf.cell(95, 6, "New Delhi, India", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(60, 6, "MPN", border=1)
    pdf.cell(45, 6, "Manufacturer", border=1)
    pdf.cell(20, 6, "Qty", border=1)
    pdf.cell(35, 6, "Unit Price (USD)", border=1)
    pdf.cell(30, 6, "Testing", border=1, ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(60, 6, "TMS320F28379D", border=1)
    pdf.cell(45, 6, "Texas Instruments", border=1)
    pdf.cell(20, 6, "800", border=1)
    pdf.cell(35, 6, "15.40", border=1)
    pdf.cell(30, 6, "WHL", border=1, ln=True)
    pdf.cell(60, 6, "AD7768-4BSTZ", border=1)
    pdf.cell(45, 6, "Analog Devices", border=1)
    pdf.cell(20, 6, "300", border=1)
    pdf.cell(35, 6, "20.90", border=1)
    pdf.cell(30, 6, "Self-test", border=1, ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Incoterm: FOB Shenzhen", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.cell(0, 6, "Payment: 100% via Escrow (HKin)", ln=True)
    pdf.cell(0, 6, "Ship to: 1Buy Hub, Hong Kong", ln=True)
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Terms and Conditions", ln=True)
    pdf.set_font("Helvetica", size=10)
    pdf.multi_cell(
        0, 6,
        "Escrow release on WHL PASS report for TMS320F28379D line.\n"
        "Relabelling to be performed at 1Buy hub prior to onward dispatch.\n"
        "Lead time 3 weeks from escrow funding.",
    )

    pdf.output(str(OUT_DIR / "sample_supplier_po_pi.pdf"))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_client_po()
    make_supplier_po_pi()
    for f in sorted(OUT_DIR.glob("*.pdf")):
        print(f"wrote {f} ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
