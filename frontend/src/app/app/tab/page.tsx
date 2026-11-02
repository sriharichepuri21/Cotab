import { redirect } from "next/navigation";

/** Retired: bookmarks and Tabby's links land on the app's Activity. */
export default function Page() {
  redirect("/app?tab=activity");
}
