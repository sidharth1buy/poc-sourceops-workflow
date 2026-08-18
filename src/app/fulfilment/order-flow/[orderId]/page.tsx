import { OrderFlowPage } from "@/components/order/order-flow-page";

export default async function OrderFlowRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <OrderFlowPage id={orderId} />;
}
