import { redirect } from "next/navigation";

/** Monthly wrap-up links from notifications open the panel in the app. */
export default async function WrapPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  redirect(`/app?panel=wrap${month ? `&month=${encodeURIComponent(month)}` : ""}`);
}
