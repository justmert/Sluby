/**
 * Load `path` from the server instead of routing inside the app, so
 * everything starts fresh: the auth gate checks the session again and a new
 * deploy's chunks are picked up.
 */
export function loadPage(path: string): void {
  window.location.assign(path);
}

/**
 * Like loadPage, but the current entry is replaced, so Back does not return
 * to it. Used on sign out, where the page left behind showed private data.
 */
export function replacePage(path: string): void {
  window.location.replace(path);
}

/** Load the current page again from the server. */
export function reloadPage(): void {
  window.location.reload();
}
