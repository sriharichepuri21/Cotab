import { redirect } from "next/navigation";

/** The old home, retired; bookmarks open the New UI's Today. */
export default function ClassicHome() {
  redirect("/app");
}
