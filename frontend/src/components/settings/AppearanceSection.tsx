import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTION, SectionLabel } from './section';

// system first: it is the default, and the other two are its halves
const ORDER: Theme[] = ['system', 'light', 'dark'];
const CHOICES = ORDER.map((v) => THEME_OPTIONS.find((o) => o.value === v)!);

// each preview depicts a theme, not the one on screen, so it draws that
// theme's ground with fixed colors (the --background of :root and the ink of
// light) instead of tokens, which would follow the current theme
const PREVIEW: Record<Theme, string> = {
  system: 'border-[#e7e5e4] bg-[linear-gradient(90deg,#fafaf9_50%,#1c1917_50%)]',
  light: 'border-[#e7e5e4] bg-[#fafaf9]',
  dark: 'border-[#2b2724] bg-[#1c1917]',
};

/** Light, dark or the system's theme, kept in this browser. */
export function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <section aria-labelledby="settings-appearance" className={SETTINGS_SECTION}>
      <SectionLabel id="settings-appearance" title="Appearance">
        Saved in this browser.
      </SectionLabel>
      <div className="flex flex-col gap-3">
        <fieldset className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
          <legend className="sr-only">Theme</legend>
          {CHOICES.map(({ value, label }) => (
            // the chosen card draws a 2px edge and gives back 1px of padding,
            // so picking one does not nudge the row
            <label
              key={value}
              className="flex cursor-pointer flex-col gap-2.5 rounded-xl border border-border-strong bg-card p-3 text-sm transition-colors duration-150 ease-(--ease-design) hover:bg-muted has-checked:border-2 has-checked:border-primary has-checked:p-[11px] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <span aria-hidden="true" className={cn('h-16 rounded-lg border', PREVIEW[value])} />
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="settings-theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                  // the card shows the ring; the dot itself does not repeat it
                  className="size-4 focus-visible:outline-none"
                />
                {label}
              </span>
            </label>
          ))}
        </fieldset>
        {theme === 'system' && (
          <p className="text-sm text-muted-foreground">Matches your system ({resolvedTheme} now)</p>
        )}
      </div>
    </section>
  );
}
