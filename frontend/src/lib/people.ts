/**
 * Your name among a tab's people: the member that is your account. A tab may
 * call you "Demo" though your account says "Demo User"; matching by name would
 * count you twice ("Split $28 6 ways" with five people). Not on the tab (or no
 * tab): your own name.
 */
export function myNameOn(
  members: Array<{ name: string; account?: string | null }> | undefined,
  account: string | undefined,
  mine: string
): string {
  return (account && members?.find((m) => m.account === account)?.name) || mine;
}
