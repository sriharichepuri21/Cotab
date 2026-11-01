"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>The error has been reported. Please reload and try again.</p>
        </main>
      </body>
    </html>
  );
}
