import { redirect } from "next/navigation";

/** Legacy tab links now land in the redesigned, URL-addressable Tabs flow. */
export default function GroupPage({ params }: { params: { id: string } }) {
  redirect(`/app?tab=circles&group=${encodeURIComponent(params.id)}`);
}
