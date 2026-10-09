import { createContext, useContext, type ReactNode } from 'react';

/*
 * where menus, selects, popovers and tooltips put their content. radix
 * portals to the end of body by default, which is outside every landmark
 * (axe "region"); the app shell provides a container at the end of its main
 * landmark instead. dialogs and sheets stay on body: they are dialogs, which
 * the rule exempts, and they set the container back to body for what opens
 * inside them, so a select in a dialog stacks above the dialog and is not
 * hidden with the page behind it.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  );
}

/** The element overlays portal into, or undefined for the default (body). */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
