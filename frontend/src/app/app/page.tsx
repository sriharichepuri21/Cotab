import { Suspense } from "react";

import NewApp from "@/components/newui/NewApp";

/** Home: the app itself. Which screen shows is in the address (NewApp). */
export default function AppHome() {
  return (
    <Suspense>
      <NewApp />
    </Suspense>
  );
}
