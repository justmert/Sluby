import { Slot } from 'radix-ui';
import { pressable } from './pressable';

/**
 * A div with the pressable micro-interactions, or with `asChild` the link or
 * button inside it: `<PressableCard asChild><Link to="…">…</Link></PressableCard>`.
 */
export function PressableCard({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp data-slot="pressable-card" className={pressable(className)} {...props} />;
}
