import { redirect } from "next/navigation";

/** Legacy tab links now land in the redesigned, URL-addressable Tabs flow. */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app?tab=circles&group=${encodeURIComponent(id)}`);
}
