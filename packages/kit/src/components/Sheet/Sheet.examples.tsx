import { Button, Field, Sheet, Stack, Text, TextInput } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './Sheet.examples.module.css';

const PAGES = ['General', 'Appearance', 'Keyboard'] as const;

/**
 * A sheet written the way a consumer writes it: the caller owns whether it is open, because mounting is opening and the sheet never closes itself; `onClose` is Escape or Close, and the caller stops rendering it.
 * An open modal makes the whole page inert, so nothing opens at load: press the button. The body is the caller's own layout, a list of pages at the left and a page at the right, and the draft of its field lives
 * above the sheet, so it is still there when the sheet is opened again. Escape in the field puts the applied value back and goes no further; with no draft it closes the sheet. The button takes the focus as it
 * is pressed (a Mac browser does not focus a button that was pressed), and gets it back when the sheet closes.
 */
export const OpenedFromTheButton = () => {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<(typeof PAGES)[number]>('General');
  const [applied, setApplied] = useState('Workstation');
  const [draft, setDraft] = useState(applied);
  return (
    <>
      <Button
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Open sheet
      </Button>
      {open ? (
        <Sheet
          title="Example sheet"
          onClose={() => {
            setOpen(false);
          }}
        >
          <div className={styles.columns}>
            <nav className={styles.pages} aria-label="Pages">
              {PAGES.map((name) => (
                <Button
                  key={name}
                  variant="ghost"
                  onClick={() => {
                    setPage(name);
                  }}
                >
                  {name}
                </Button>
              ))}
            </nav>
            <div className={styles.page}>
              <Stack gap={12}>
                <Text as="h3" variant="title">
                  {page}
                </Text>
                <Text as="p" tone="muted">
                  The settings of this page are drawn here, and the page scrolls on its own when it is longer than the sheet.
                </Text>
                <Field label="Display name" layout="stacked">
                  <TextInput
                    value={draft}
                    dirty={draft !== applied}
                    onValueChange={setDraft}
                    onCommit={setApplied}
                    onRevert={() => {
                      setDraft(applied);
                    }}
                  />
                </Field>
              </Stack>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
};
