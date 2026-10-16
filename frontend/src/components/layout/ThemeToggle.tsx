import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * One press to the other theme. It picks light or dark outright, so it also
 * leaves System; Settings and the account menu still offer all three.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className={cn('[&_svg]:size-4.5', className)}
    >
      {/* the icon shows the theme a press gives, as the label says */}
      {next === 'dark' ? <Moon /> : <Sun />}
    </Button>
  );
}
