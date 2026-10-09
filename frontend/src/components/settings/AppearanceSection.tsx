import { SectionHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';

/** Light, dark or the system's theme, kept in this browser. */
export function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <section aria-labelledby="settings-appearance">
      <SectionHeader
        id="settings-appearance"
        title="Appearance"
        description="Follows your system by default. Your choice is saved in this browser."
      />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span id="settings-theme" className="text-sm font-medium">
            Theme
          </span>
          <ToggleGroup
            type="single"
            variant="segmented"
            value={theme}
            // radix sends an empty value when the pressed item is pressed again
            onValueChange={(v) => v && setTheme(v as Theme)}
            aria-labelledby="settings-theme"
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="gap-1.5 px-3 data-[state=on]:font-medium data-[state=on]:text-foreground"
              >
                <Icon aria-hidden="true" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {theme === 'system' && (
            <span className="text-sm text-muted-foreground">
              Matches your system ({resolvedTheme} now)
            </span>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
