import { EscrowOrderDetail } from "@/components/order/escrow-order-detail";

export default async function EscrowOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EscrowOrderDetail id={id} />;
}
