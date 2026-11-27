import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useFieldControl } from '../FormControl/useFieldControl';
import styles from './Slider.module.css';

/** A single, finite value on the grid starting at `min`, in increments of `step`. */
export type SliderProps = {
  /** Accepted value. During a gesture only the slider's local preview moves. */
  readonly value: number;
  /** Optional transient preview. On cancellation it returns to the latest accepted value, including edits from elsewhere. */
  readonly onValueChange?: ((value: number) => void) | undefined;
  /** Apply one changed value on release, or on a standalone assistive-technology adjustment. Never called on cancellation. */
  readonly onCommit?: ((value: number) => void) | undefined;
  /** Inclusive lower bound, 0 by default. */
  readonly min?: number | undefined;
  /** Inclusive upper bound, 100 by default. */
  readonly max?: number | undefined;
  /** Positive step, 1 by default. The browser performs the stepping. */
  readonly step?: number | undefined;
  /** Unit for the visible and accessible readout, such as "%", "px" or "×". */
  readonly unit?: string | undefined;
  /** Accessible name when not wrapped in a Field. */
  readonly label?: string | undefined;
  readonly invalid?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  /** Keeps the slider focusable and describes why it cannot change. */
  readonly disabledReason?: string | undefined;
} & DataAttributes;

const ADJUSTMENT_KEYS: Readonly<Record<string, true>> = {
  ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true, PageUp: true, PageDown: true, Home: true, End: true,
};

type Gesture = {
  /** A pointer ID or an adjustment key. A release from another input cannot commit this gesture. */
  readonly source: number | string;
  readonly start: number;
  readonly listeners: AbortController;
  last: number;
  cancelled: boolean;
};

/** A native horizontal range with a live numeric readout. No focus, document listeners or persistence work while idle. */
export function Slider({ value, onValueChange, onCommit, min = 0, max = 100, step = 1, unit, label, invalid, readOnly, disabledReason, ...rest }: SliderProps) {
  const control = useFieldControl({ label, invalid, readOnly, disabledReason });
  const accepted = Math.max(min, Math.min(max, value));
  const [draft, setDraft] = useState<number | null>(null);
  const active = useRef<Gesture | null>(null);
  const latest = useRef({ accepted, onValueChange, onCommit });

  const finish = useCallback((action: 'commit' | 'cancel' | 'suppress' | 'unmount') => {
    const gesture = active.current;
    if (gesture === null) {
      return;
    }

    // Escape or a lock can happen while the pointer/key is still down. Ignore the browser's remaining inputs until release.
    if (action !== 'suppress') {
      active.current = null;
      gesture.listeners.abort();
    }

    if (gesture.cancelled) {
      return;
    }

    gesture.cancelled = action !== 'commit';
    if (action !== 'unmount') {
      setDraft(null);
    }

    const current = latest.current;
    if (action === 'commit') {
      if (gesture.last !== gesture.start) {
        current.onCommit?.(gesture.last);
      }
    } else if (gesture.last !== current.accepted) {
      current.onValueChange?.(current.accepted);
    }
  }, []);

  useLayoutEffect(() => {
    latest.current = { accepted, onValueChange, onCommit };
    if (control.locked) {
      finish('suppress');
    }
  }, [accepted, onValueChange, onCommit, control.locked, finish]);
  useLayoutEffect(() => () => {
    finish('unmount');
  }, [finish]);

  const begin = (input: HTMLInputElement, source: number | string) => {
    const previous = active.current;
    if (previous !== null) {
      if (!previous.cancelled) {
        return previous.source === source;
      }

      // A fresh down also recovers a cancelled gesture whose physical release never reached this document.
      previous.listeners.abort();
    }

    const doc = input.ownerDocument;
    const listeners = new (doc.defaultView?.AbortController ?? AbortController)();
    const start = input.valueAsNumber;
    active.current = { source, start, last: start, cancelled: false, listeners };
    const capture = { signal: listeners.signal, capture: true };
    // Do not take pointer capture away from the browser's native thumb. Observe its release even off the control.
    if (typeof source === 'number') {
      doc.addEventListener('pointerup', event => {
        if (event.pointerId === source) {
          finish('commit');
        }
      }, capture);
      doc.addEventListener('pointercancel', event => {
        if (event.pointerId === source) {
          finish('cancel');
        }
      }, capture);
    } else {
      doc.addEventListener('keyup', event => {
        if (event.key === source) {
          finish('commit');
        }
      }, capture);
    }

    doc.defaultView?.addEventListener('blur', () => {
      finish('cancel');
    }, { signal: listeners.signal });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) {
        finish('cancel');
      }
    }, capture);
    return true;
  };

  const shown = control.locked ? accepted : draft ?? accepted;
  const position = max > min ? 100 * (shown - min) / (max - min) : 0;
  const text = unit ? `${shown}${/^\p{L}/u.test(unit) ? ' ' : ''}${unit}` : String(shown);
  return (
    <span {...dataAttributes(rest)} className={styles.root} data-ov-part="slider" data-ov-disabled={control.reason === undefined ? undefined : 'true'}>
      <span className={styles.rail} style={{ '--_position': `${position}%` }}>
        <input
          id={control.id}
          className={styles.input}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          tabIndex={0}
          aria-label={control.ariaLabel}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid || undefined}
          aria-disabled={control.reason === undefined ? undefined : true}
          aria-readonly={control.readOnly || undefined}
          aria-valuetext={unit ? text : undefined}
          onPointerDown={event => {
            if (event.button !== 0) {
              return;
            }

            if (control.locked || !begin(event.currentTarget, event.pointerId)) {
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onLostPointerCapture={event => {
            if (active.current?.source === event.pointerId) {
              finish('suppress');
            }
          }}
          onKeyDown={event => {
            if (event.key === 'Escape' && active.current !== null && !active.current.cancelled) {
              event.preventDefault();
              event.stopPropagation();
              finish('suppress');
            } else if (Object.hasOwn(ADJUSTMENT_KEYS, event.key) && (control.locked || (event.repeat && active.current?.cancelled) || !begin(event.currentTarget, event.key))) {
              event.preventDefault();
            }
          }}
          onBlur={() => {
            finish('suppress');
          }}
          onChange={event => {
            const next = event.currentTarget.valueAsNumber;
            const gesture = active.current;
            if (control.locked || gesture?.cancelled || event.currentTarget.ownerDocument.hidden || next === (gesture?.last ?? accepted)) {
              return;
            }

            if (gesture === null) {
              // VoiceOver and other assistive technology can adjust a native range without a pointer or keyboard sequence.
              onValueChange?.(next);
              onCommit?.(next);
            } else {
              gesture.last = next;
              setDraft(next);
              onValueChange?.(next);
            }
          }}
        />
      </span>
      <span className={styles.value} aria-hidden="true">{text}</span>
      {control.reasonId === undefined ? null : <span id={control.reasonId} hidden>{control.reason}</span>}
    </span>
  );
}
