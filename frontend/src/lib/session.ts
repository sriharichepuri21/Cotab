import { me, type SignedIn } from "@/lib/api";
import { routes, withNext } from "@/lib/routes";

type Router = { push: (href: string) => void; replace: (href: string) => void };

/**
 * Where someone goes right after signing in or up, whichever way they did it:
 * the code screen until their email is confirmed, then onboarding if they
 * haven't picked what Cotab is for, then wherever they were headed.
 */
export async function goAfterSignIn(router: Router, signedIn: SignedIn, next: string | null) {
  if (!signedIn.email_verified) {
    router.push(next ? withNext(routes.verify, next) : routes.verify);
    return;
  }
  const user = await me();
  router.push(next ?? (user.intent ? routes.home : routes.welcome));
}
