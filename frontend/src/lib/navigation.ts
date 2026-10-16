/**
 * Load `path` from the server instead of routing inside the app, so
 * everything starts fresh: the auth gate checks the session again and a new
 * deploy's chunks are picked up.
 */
export function loadPage(path: string): void {
  window.location.assign(path);
}

/** Load the current page again from the server. */
export function reloadPage(): void {
  window.location.reload();
}
