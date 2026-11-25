import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { IconButton } from '../IconButton';
import type { IconName } from '../Icon';
import { menuTrigger } from '../Menu';
import { RovingGroup } from '../RovingGroup';
import styles from './ToolHeader.module.css';

type ToolHeaderActionBase = {
  /** A stable key, unique among the actions. */
  readonly id: string;
  /** The button's accessible name, and its tip. Required: the button shows only a glyph. */
  readonly label: string;
  readonly icon: IconName;
};

/** An action that runs a command. */
export type ToolHeaderCommand = ToolHeaderActionBase & {
  readonly onSelect: () => void;
  /** Why the command is unavailable. The button stays focusable and does nothing; the reason is its description. */
  readonly disabledReason?: string | undefined;
  readonly menu?: undefined;
};

/** An action that opens a menu. */
export type ToolHeaderMenu = ToolHeaderActionBase & {
  /** The ID `useMenu` returned for the menu this button opens, which the owning view registered once. */
  readonly menu: string;
  readonly onSelect?: undefined;
  readonly disabledReason?: undefined;
};

export type ToolHeaderAction = ToolHeaderCommand | ToolHeaderMenu;

export type ToolHeaderProps = {
  /** The name of the region the header belongs to. Required: it names the header's group and its actions' toolbar. */
  readonly label: string;
  /** The visible title, on one line, clipped with an ellipsis. */
  readonly title: string;
  /** Icon buttons at the end of the header: one Tab stop, moved by the arrow keys. They show on hover and on focus within; a menu that is open stays shown. */
  readonly actions?: readonly ToolHeaderAction[] | undefined;
} & DataAttributes;

/**
 * The compact header of a side tool: a title and, at the end, a cluster of icon buttons. Props are closed: no `className`, no
 * `style`; `data-*` passes through. The actions are hidden by opacity until the pointer or the focus is in the header, so a button
 * stays reachable by keyboard and by assistive technology at rest.
 */
export function ToolHeader({ label, title, actions = [], ...rest }: ToolHeaderProps) {
  return (
    <div {...dataAttributes(rest)} className={styles.root} role="group" aria-label={label}>
      <h2 className={styles.title} dir="auto" data-ov-clip="">
        {title}
      </h2>
      {actions.length === 0 ? null : (
        <div className={styles.actions}>
          <RovingGroup label={`${label} actions`} role="toolbar" gap={4} align="center">
            {actions.map((action) =>
              action.menu === undefined ? (
                <IconButton
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  variant="ghost"
                  disabledReason={action.disabledReason}
                  data-ov-tip={action.label}
                  onClick={() => {
                    action.onSelect();
                  }}
                />
              ) : (
                <IconButton key={action.id} icon={action.icon} label={action.label} variant="ghost" data-ov-tip={action.label} {...menuTrigger(action.menu)} />
              ),
            )}
          </RovingGroup>
        </div>
      )}
    </div>
  );
}
