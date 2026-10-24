/**
 * Inviting someone who isn't on Cotab yet: a link made for them, sent from
 * your own phone (Messages or the share sheet), so it costs nothing and comes
 * from someone they know.
 */

/** The tab's share page, opened as this person: "Join as Ben" is one tap. */
export const inviteUrl = (origin: string, shareCode: string, memberId: string) =>
  `${origin}/share/${shareCode}?as=${encodeURIComponent(memberId)}`;

export function inviteMessage(from: string, tab: { name: string; kind?: string }, link: string) {
  const what = tab.kind === "direct" ? "started a tab with you" : `added you to ${tab.name}`;
  return `${from} ${what} on Cotab. See what's on it and join: ${link}`;
}

/**
 * A link that opens Messages addressed to them with the text filled in.
 * iPhones read the text after "&body=", everything else after "?body=".
 */
export function smsHref(phone: string, body: string, userAgent: string) {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(userAgent);
  return `sms:${phone}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
}
