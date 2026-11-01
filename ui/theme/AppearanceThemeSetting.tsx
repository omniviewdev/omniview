import type { CSSProperties, KeyboardEvent } from 'react';
import { themeRegistry, useThemeList } from '@omniviewdev/base-ui';
import { LuCheck } from 'react-icons/lu';
import { useAppTheme } from './AppThemeController';
import styles from './AppearanceThemeSetting.module.css';

/** Registry-backed previews keep a string setting independent from its visual editor. */
export default function AppearanceThemeSetting() {
  const themes = useThemeList();
  const { requestedThemeId, selectTheme } = useAppTheme();
  const available = themes.some(theme => theme.id === requestedThemeId);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusedId = event.target instanceof HTMLElement ? event.target.closest('[role="radio"]')?.id : undefined;
    const currentId = focusedId ?? `theme-${encodeURIComponent(requestedThemeId)}`;
    const index = Math.max(0, themes.findIndex(theme => `theme-${encodeURIComponent(theme.id)}` === currentId));
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % themes.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + themes.length) % themes.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = themes.length - 1;
    } else {
      return;
    }

    if (!themes[next]) {
      return;
    }

    event.preventDefault();
    void selectTheme(themes[next].id);
    document.getElementById(`theme-${encodeURIComponent(themes[next].id)}`)?.focus();
  };

  return <div role='radiogroup' aria-label='Theme' className={styles.Grid} onKeyDown={onKeyDown}>
    {themes.map((theme, index) => {
      const definition = themeRegistry.get(theme.id)?.definition;
      const tokens = Object.fromEntries(Object.entries(definition?.tokens ?? {})
        .map(([key, value]) => [`--ov-${key.replaceAll('.', '-')}`, value])) as CSSProperties;
      const selected = theme.id === requestedThemeId;
      return <button key={theme.id} id={`theme-${encodeURIComponent(theme.id)}`} type='button'
        role='radio' aria-checked={selected} aria-label={theme.name}
        tabIndex={selected || (!available && index === 0) ? 0 : -1}
        className={styles.Choice} onClick={() => {
          void selectTheme(theme.id); 
        }}>
        <span aria-hidden='true' className={styles.Preview} data-ov-theme={theme.base} style={tokens}>
          <span className={styles.Rail}><i /><i /><i /></span>
          <span className={styles.Page}><i /><i /><i /></span>
        </span>
        <span className={styles.Label}>{theme.name}{selected && <LuCheck aria-hidden='true' size={13} />}</span>
      </button>;
    })}
    {!available && <button type='button' role='radio' aria-checked='true' disabled className={styles.Choice}>
      Unavailable: {requestedThemeId}
    </button>}
  </div>;
}
