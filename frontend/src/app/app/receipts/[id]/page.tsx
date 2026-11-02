import { redirect } from "next/navigation";

export default async function ReceiptRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app?receipt=${encodeURIComponent(id)}`);
}
