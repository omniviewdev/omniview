// K, the kit's LogView, as ui-next mounts it: the built package, its stylesheet and a ThemeProvider. The feed is the bench's source.
import '@omniviewdev/kit/styles.css';
import { LogView, ThemeProvider, type LogFeed } from '@omniviewdev/kit';
import type { Probe } from '../harness';

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('#stage [role="grid"]'),
  headerHeight: () => document.querySelector('#stage [role="row"][aria-rowindex="1"]')?.getBoundingClientRect().height ?? 0,
  input: () => document.querySelector<HTMLInputElement>('#stage input[type="search"]'),
  lane: () => document.querySelector<HTMLElement>('#stage [data-ov-lane]'),
  following: () => (document.querySelector('#stage [aria-label="Session status"]')?.textContent ?? '').includes('Following'),
};

export default function KitVariant({ feed }: { readonly feed: LogFeed }) {
  return (
    <ThemeProvider>
      <LogView label="bench · app" feed={feed} />
    </ThemeProvider>
  );
}
