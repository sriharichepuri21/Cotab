import { redirect } from "next/navigation";

/** Keep bookmarks working without exposing the retired Splits interface. */
export default function GroupsPage() {
  redirect("/app?tab=circles");
}
