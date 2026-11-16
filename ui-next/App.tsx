import {
  DEFAULT_DENSITY,
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME_ID,
  DENSITIES,
  Stack,
  TEXT_SIZES,
  THEMES,
  Text,
  ThemeProvider,
  tokenVar,
  useTheme,
} from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './App.module.css';

// Colour roles shown as swatches: they change with the theme, which is how a flip is seen at a glance.
const SWATCHES = [
  { label: 'bg-window', value: tokenVar('--ov-bg-window') },
  { label: 'bg-island', value: tokenVar('--ov-bg-island') },
  { label: 'accent', value: tokenVar('--ov-accent') },
  { label: 'link', value: tokenVar('--ov-link') },
  { label: 'success-fg', value: tokenVar('--ov-success-fg') },
  { label: 'warning-fg', value: tokenVar('--ov-warning-fg') },
  { label: 'error-fg', value: tokenVar('--ov-error-fg') },
];

function next<Value>(values: readonly Value[], current: Value): Value {
  return values[(values.indexOf(current) + 1) % values.length] ?? current;
}

function AppearanceRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <li className={styles.row}>
      <Stack direction="row" justify="between" align="center">
        <Text>{label}</Text>
        <Text tone="muted">{value}</Text>
      </Stack>
    </li>
  );
}

type FrameProps = {
  readonly onNextTheme: () => void;
  readonly onNextDensity: () => void;
  readonly onNextTextSize: () => void;
};

// The themed app frame: a window plane, an island, and the kit's two parts on them.
// The three buttons exercise the theme engine end to end in the real page; the Settings page replaces them.
function Frame({ onNextTheme, onNextDensity, onNextTextSize }: FrameProps) {
  const { activeTheme, density, textSize } = useTheme();

  return (
    <main className={styles.window}>
      <div className={styles.island}>
        <Stack gap={16}>
          <Stack gap={4}>
            <Text as="h1" variant="heading">Omniview ui-next</Text>
            <Text tone="muted">The new UI&apos;s frame: kit tokens, themes, and the first two parts.</Text>
          </Stack>
          <Stack gap={8}>
            <Text as="h2" variant="title">Appearance</Text>
            <ul className={styles.rows}>
              <AppearanceRow label="Theme" value={activeTheme.name} />
              <AppearanceRow label="Density" value={density} />
              <AppearanceRow label="Text size" value={`${textSize}%`} />
            </ul>
          </Stack>
          <Stack direction="row" gap={8}>
            <button type="button" className={styles.control} onClick={onNextTheme}>Next theme</button>
            <button type="button" className={styles.control} onClick={onNextDensity}>Next density</button>
            <button type="button" className={styles.control} onClick={onNextTextSize}>Next text size</button>
          </Stack>
          <Stack gap={8}>
            <Text as="h2" variant="title">Colour roles</Text>
            <ul className={styles.swatches}>
              {SWATCHES.map((swatch) => (
                <li key={swatch.label} className={styles.swatch}>
                  <span className={styles.chip} style={{ '--_swatch': swatch.value }} />
                  <Text variant="caption" tone="muted">{swatch.label}</Text>
                </li>
              ))}
            </ul>
          </Stack>
        </Stack>
      </div>
    </main>
  );
}

export function App() {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [density, setDensity] = useState(DEFAULT_DENSITY);
  const [textSize, setTextSize] = useState(DEFAULT_TEXT_SIZE);

  return (
    <ThemeProvider themeId={themeId} density={density} textSize={textSize}>
      <Frame
        onNextTheme={() => {
          setThemeId((current) => next(THEMES.map((theme) => theme.id), current));
        }}
        onNextDensity={() => {
          setDensity((current) => next(DENSITIES, current));
        }}
        onNextTextSize={() => {
          setTextSize((current) => next(TEXT_SIZES, current));
        }}
      />
    </ThemeProvider>
  );
}
