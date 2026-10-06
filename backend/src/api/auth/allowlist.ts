/**
 * Who may use the Studio, for one sign-in provider. Provider neutral: a
 * provider hands in its raw setting (github: GITHUB_ALLOWED_USERS) and how to
 * normalise its handles, and gets the same rules as every other provider.
 *
 * A comma-separated list of entries:
 * - `*` opens sign-up to every account of the provider. An empty list does too
 *   (older deployments relied on that), and the server warns at startup.
 * - `id:<subject>` admits the account with that stable provider id (github:
 *   the numeric account id), whatever its handle is now or later.
 * - anything else is a handle (github: a login), matched case-insensitively
 *   against the handle the provider reports at sign-in. The first account to
 *   sign in with it is pinned to the entry (allowlist_pins), and from then on
 *   the entry admits that account only: through its renames, and never the
 *   next owner of a freed handle.
 *
 * Sign-in decides with the provider's live answer; every later request
 * decides on the account's stable ids and pins only, so editing the list takes
 * effect on the next request without anyone signing in again, except that a
 * handle entry nobody has pinned yet admits its account at that account's
 * next sign-in.
 */
export class Allowlist {
  /** No restriction: the list is empty or holds `*`. */
  readonly open: boolean;
  /** The list holds `*`, an explicit choice rather than an unset variable. */
  readonly explicitlyOpen: boolean;
  readonly subjects: ReadonlySet<string>;
  readonly handles: ReadonlySet<string>;

  constructor(
    raw: string,
    private readonly normalizeHandle: (handle: string) => string,
  ) {
    const entries = raw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const subjects = new Set<string>();
    const handles = new Set<string>();
    for (const e of entries) {
      if (e === '*') continue;
      if (e.toLowerCase().startsWith('id:')) {
        const subject = e.slice(3).trim();
        if (subject) subjects.add(subject);
      } else {
        handles.add(normalizeHandle(e));
      }
    }
    this.explicitlyOpen = entries.includes('*');
    this.open = this.explicitlyOpen || entries.length === 0;
    this.subjects = subjects;
    this.handles = handles;
  }

  /**
   * The decision at sign-in. `pins` maps each pinned handle entry of this
   * provider to the subject it is pinned to. When the account takes an
   * unpinned handle entry, `pin` names it and the caller records the pin in
   * the same transaction that signs the account in.
   */
  atSignIn(
    subject: string,
    handle: string,
    pins: ReadonlyMap<string, string>,
  ): { allowed: boolean; pin?: string } {
    const h = this.normalizeHandle(handle);
    const listed = this.handles.has(h);
    const pinnedTo = pins.get(h);
    const pin = listed && pinnedTo === undefined ? h : undefined;

    if (this.open || this.subjects.has(subject)) return { allowed: true, pin };
    for (const [entry, pinned] of pins) {
      if (pinned === subject && this.handles.has(entry)) return { allowed: true, pin };
    }
    if (listed && pinnedTo === undefined) return { allowed: true, pin };
    return { allowed: false };
  }

  /** The decision on a later request, from the account's id and its pinned entries. */
  allows(subject: string, pinnedEntries: readonly string[]): boolean {
    if (this.open || this.subjects.has(subject)) return true;
    return pinnedEntries.some((e) => this.handles.has(e));
  }

  /**
   * The decision for an owner address older versions wrote from a handle
   * (github:<login>), whose data no account has claimed yet. It names a handle
   * only, so it passes only while that handle is listed and not pinned: once
   * an account holds the entry, an unclaimed address cannot show it is that
   * account.
   */
  allowsUnclaimedHandle(handle: string, entryPinned: boolean): boolean {
    if (this.open) return true;
    return this.handles.has(this.normalizeHandle(handle)) && !entryPinned;
  }
}
