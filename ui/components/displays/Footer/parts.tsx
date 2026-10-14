import React from 'react';
import { Popover, StatusDot, type StatusDotStatus } from '@omniviewdev/base-ui';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './Footer.module.css';

/*
 * Small building blocks shared by the status footer items. Status colors come
 * from the base-ui semantic tokens (success/warning/danger/info).
 */

export type FooterTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type ChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: React.ReactNode;
  icon?: React.ReactNode;
  tone: FooterTone;
};

/** Solid uppercase label. Renders a button so it can trigger a popover. */
export const FooterChip = React.forwardRef<HTMLButtonElement, ChipProps>(
  function FooterChip({ label, icon, tone, className, ...props }, ref) {
    return (
      <button ref={ref} type='button' data-tone={tone} className={cx(styles.Chip, className)} {...props}>
        {icon}
        {label}
      </button>
    );
  },
);

/** Same look as FooterChip, but static (not focusable). */
export function FooterLabel({ label, icon, tone }: { label: React.ReactNode; icon?: React.ReactNode; tone: FooterTone }) {
  return (
    <span data-tone={tone} className={styles.Chip}>
      {icon}
      {label}
    </span>
  );
}

/** Plain text + status dot item that opens a popover. */
export const FooterTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function FooterTrigger({ className, ...props }, ref) {
    return <button ref={ref} type='button' className={cx(styles.Trigger, className)} {...props} />;
  },
);

export function Dot({ status, pulse }: { status: StatusDotStatus; pulse?: boolean }) {
  return <StatusDot size='xs' status={status} pulse={pulse} />;
}

type FooterPopoverProps = {
  /** The element that toggles the popover (a FooterChip or FooterTrigger). */
  trigger: React.ReactElement;
  /** Hover hint shown while the popover is closed. */
  tooltip?: string;
  width?: 'narrow' | 'default' | 'wide';
  /** Popover body. Call `close` after an action that should dismiss it. */
  children: (close: () => void) => React.ReactNode;
};

/** A footer item with an upward popover anchored to it. */
export function FooterPopover({ trigger, tooltip, width = 'default', children }: FooterPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <HintTooltip content={tooltip} disabled={open} side='top'>
        <Popover.Trigger render={trigger} />
      </HintTooltip>
      <Popover.Portal>
        <Popover.Positioner side='top' align='center' sideOffset={4}>
          <Popover.Popup className={styles.Popup} data-width={width}>
            {open && children(close)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PopoverHeader({ icon, title, children }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={styles.Header}>
      <div className={styles.HeaderTitle}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

export function PopoverAction({
  icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'success' | 'danger' | 'info';
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      className={styles.Action}
      data-tone={tone}
      disabled={disabled}
      aria-label={label || undefined}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

export function cx(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(' ');
}

export { styles as footerStyles };
