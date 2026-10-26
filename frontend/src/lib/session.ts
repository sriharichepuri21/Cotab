import { me, type SignedIn, type User } from "@/lib/api";
import { routes, withNext } from "@/lib/routes";

type Router = { push: (href: string) => void; replace: (href: string) => void };

/**
 * The next step for a confirmed account: their mobile number if they haven't
 * added it, then onboarding if they haven't picked what Cotab is for, then
 * wherever they were headed.
 */
export function afterConfirmed(user: Pick<User, "phone" | "intent">, next: string | null) {
  if (user.phone === null) return next ? withNext(routes.phone, next) : routes.phone;
  const destination = next?.startsWith("/app") ? routes.home : next;
  return destination ?? (user.intent ? routes.home : routes.welcome);
}

/**
 * Where someone goes right after signing in or up, whichever way they did it:
 * the code screen until their email is confirmed, then the steps above.
 */
export async function goAfterSignIn(router: Router, signedIn: SignedIn, next: string | null) {
  if (!signedIn.email_verified) {
    router.push(next ? withNext(routes.verify, next) : routes.verify);
    return;
  }
  router.push(afterConfirmed(await me(), next));
}
