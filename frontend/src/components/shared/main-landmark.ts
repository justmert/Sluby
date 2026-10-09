/**
 * The page's one <main>, for menus that mount there instead of in <body>, so
 * an open menu stays inside a landmark (axe "region"). Null outside the app
 * shell (tests, the sign-in screen), and the menu then mounts in <body>.
 */
export function mainLandmark(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector('main');
}
