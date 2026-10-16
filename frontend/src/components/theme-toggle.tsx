import { Moon, Sun } from 'lucide-react';
import * as m from 'motion/react-m';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { transition } from '@/lib/motion';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';

// motion rather than css transitions: while the theme switches, index.css
// limits every css transition to colors, which would make the icons jump
const shown = { opacity: 1, scale: 1, rotate: 0 };
const hidden = (turn: number) => ({ opacity: 0, scale: 0.5, rotate: turn });

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme" className="relative">
          <m.span
            aria-hidden="true"
            className="absolute flex"
            initial={false}
            animate={dark ? hidden(-90) : shown}
            transition={transition.base}
          >
            <Sun />
          </m.span>
          <m.span
            aria-hidden="true"
            className="absolute flex"
            initial={false}
            animate={dark ? shown : hidden(90)}
            transition={transition.base}
          >
            <Moon />
          </m.span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEME_OPTIONS.map(({ value, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
