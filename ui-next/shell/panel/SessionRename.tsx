import { TextInput } from '@omniviewdev/kit';
import { useEffect, useRef, useState } from 'react';
import styles from './Header.module.css';

/** The name of a session tab, edited in place (S118 Rename session…): Enter commits and gives the focus back to the tab, Escape cancels, and leaving the field commits and leaves the focus where it went. */
export function SessionRename({ title, onDone }: { readonly title: string; readonly onDone: (title: string | null, refocus: boolean) => void }) {
  const [draft, setDraft] = useState(title);
  // The title the field started with: a field left as it was reports nothing, whatever the session's title has become since (a program may have set one).
  const [initial] = useState(title);
  const finish = (value: string, refocus: boolean): void => {
    onDone(value === initial ? null : value, refocus);
  };

  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);

  return (
    <span ref={ref} className={styles.sessionRename}>
      <TextInput
        label="Session name"
        value={draft}
        onValueChange={setDraft}
        onCommit={(value) => {
          finish(value, true);
        }}
        onBlur={() => {
          finish(draft, false);
        }}
        onRevert={() => {
          onDone(null, true);
        }}
        dirty
      />
    </span>
  );
}
