import { Stack, Text } from '@omniviewdev/kit';
import { examples } from '@omniviewdev/kit/examples';
import styles from './PartsPage.module.css';

/** `WithIconDisabled` becomes "With icon disabled": the name of an example, in words. */
function inWords(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
}

/**
 * Every part of the kit in every state it has an example for, rendered from the examples entry (`@omniviewdev/kit/examples`): the
 * one place the parts are seen on a real page, in every theme, density and text size the frame flips through. A part is shown here
 * because it ships an examples file (docs/ui-next/AGENTS.md, "The kit"); this page has no list of its own to keep current.
 */
export function PartsPage() {
  return (
    <Stack gap={16}>
      <Stack gap={4}>
        <Text as="h2" variant="title">Parts</Text>
        <Text variant="caption" tone="muted">Each part in each state it has an example for, from its examples file.</Text>
      </Stack>
      {Object.entries(examples).map(([part, set]) => (
        <Stack key={part} gap={8}>
          <Text as="h3" variant="title">{part}</Text>
          <div className={styles.examples}>
            {Object.entries(set).map(([name, Example]) => (
              <figure key={name} className={styles.example} data-example={`${part}/${name}`}>
                <figcaption className={styles.caption}>
                  <Text variant="caption" tone="muted">{inWords(name)}</Text>
                </figcaption>
                <div className={styles.stage}>
                  <Example />
                </div>
              </figure>
            ))}
          </div>
        </Stack>
      ))}
    </Stack>
  );
}
