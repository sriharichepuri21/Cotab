"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { isAuthed } from "@/lib/api";
import { routes } from "@/lib/routes";

/**
 * Temporary front door: the public landing page arrives in the next step.
 * Until then `/` sends signed-in people to the app and everyone else to sign in.
 */
export default function Root() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isAuthed() ? routes.home : routes.login);
  }, [router]);
  return null;
}
