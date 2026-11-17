import { useEffect, useId, useRef } from 'react';
import { attachTooltips } from './controller';
import styles from './TooltipHost.module.css';

/**
 * The one tooltip of the window: mount it once, at the application root, beside the ThemeProvider. It renders a single popover element
 * (`role="tooltip"`, in the top layer) and listens on the document for the triggers of the whole page, however many there are:
 * `{...tip('text')}` on an element, `data-ov-clip` on text that may be cut. It has no props.
 *
 * A second host in one window throws: the whole point is one popup. A tip never carries a fact alone (design 13 R2, 14 I2): the name of
 * an icon button, a reason printed beside its command, an absolute time that is also in the inspector.
 */
export function TooltipHost() {
  const host = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const element = host.current;
    return element === null ? undefined : attachTooltips(element);
  }, []);

  return <div ref={host} id={id} role="tooltip" popover="manual" className={styles.root} />;
}
