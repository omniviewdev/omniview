import { Icon, Text, THEMES, useField, type ThemeId } from '@omniviewdev/kit';
import { useId, type KeyboardEvent } from 'react';
import styles from './ThemePicker.module.css';

type ThemePickerProps = {
  readonly label: string;
  readonly value: string;
  readonly onChoose: (id: ThemeId) => void;
};

/** The saved ID can belong to a theme this build does not ship. Opening Settings must not replace it with Void. */
export function ThemePicker({ label, value, onChoose }: ThemePickerProps) {
  const field = useField();
  const name = useId();
  const chosen = THEMES.findIndex(theme => theme.id === value);
  const stop = Math.max(0, chosen);
  const locked = field?.disabledReason !== undefined || field?.readOnly === true;
  const unavailable = value !== '' && chosen === -1;
  const reasonId = field?.disabledReason && !field.reasonShown ? `${name}-reason` : undefined;
  const describedBy = [field?.describedBy, reasonId].filter(Boolean).join(' ') || undefined;

  // Native radio groups already handle arrows, Space and wrapping. Add the end keys used by the other choice controls.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked || event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== 'Home' && event.key !== 'End')) {
      return;
    }

    event.preventDefault();
    const id = event.key === 'Home' ? THEMES[0].id : THEMES[THEMES.length - 1]!.id;
    const radio = event.currentTarget.querySelector<HTMLInputElement>(`input[value="${id}"]`);
    radio?.focus();
    radio?.click();
  };

  return (
    <div
      className={styles.grid}
      role="radiogroup"
      aria-label={field ? undefined : label}
      aria-labelledby={field?.labelId}
      aria-describedby={describedBy}
      aria-invalid={field?.invalid || undefined}
      aria-disabled={field?.disabledReason ? true : undefined}
      aria-readonly={field?.readOnly || undefined}
      aria-required={field?.required || undefined}
      tabIndex={locked ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      {THEMES.map((theme, index) => {
        const checked = theme.id === value;
        const description = `${name}-${theme.id}-description`;
        const scheme = theme.id.startsWith('high-contrast-') ? 'High contrast' : theme.scheme === 'dark' ? 'Dark' : 'Light';
        return (
          <label key={theme.id} className={styles.card}>
            <input
              className={styles.radio}
              type="radio"
              name={name}
              id={index === stop && !unavailable ? field?.controlId : undefined}
              value={theme.id}
              aria-label={theme.name}
              aria-describedby={description}
              checked={checked}
              tabIndex={index === stop ? 0 : -1}
              disabled={locked}
              onChange={() => onChoose(theme.id)}
            />
            <span className={styles.body}>
              <Text>{theme.name}</Text>
              <span id={description}><Text variant="caption" tone={checked ? 'default' : 'muted'}>{scheme}</Text></span>
              {/* Scope the palette to the miniature window; the card uses the active theme's selection paint. */}
              <span className={styles.preview} data-ov-theme={theme.id} aria-hidden="true">
                <span className={styles.line} /><span className={styles.shortLine} /><span className={styles.chip} />
              </span>
            </span>
            <span className={styles.mark} aria-hidden="true">{checked ? <Icon name="check" /> : null}</span>
          </label>
        );
      })}
      {unavailable ? (
        <label className={styles.unavailable}>
          <input type="radio" name={name} value={value} checked disabled />
          <Text variant="caption" tone="muted">Unavailable: {value}</Text>
        </label>
      ) : null}
      {reasonId ? <span id={reasonId} hidden>{field?.disabledReason}</span> : null}
    </div>
  );
}
