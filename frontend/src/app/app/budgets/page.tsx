import { redirect } from "next/navigation";

/** Retired: bookmarks and Tabby's links land on the app's Budgets. */
export default function Page() {
  redirect("/app?panel=budgets");
}
