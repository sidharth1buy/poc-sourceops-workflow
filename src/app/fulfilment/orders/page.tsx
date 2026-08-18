import { redirect } from "next/navigation";

// The orders list moved onto the console's landing page (Order Processing) when the sidebar's
// separate Orders item went away — one list, one place. Old links and bookmarks land there.
export default function OrdersIndexRedirect() {
  redirect("/fulfilment");
}
