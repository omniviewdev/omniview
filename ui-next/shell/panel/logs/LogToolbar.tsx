import { IconButton, RovingGroup, tip } from '@omniviewdev/kit';
import { LOG_TOOLS_LABEL, tipOf, type LogTool, type LogToolId } from './toolbar';

type LogToolbarProps = {
  /** The buttons, in the order they stand (`logToolsOf`). */
  readonly tools: readonly LogTool[];
  /** A button was pressed. A button that cannot apply is never reported: the kit's button does nothing for it. */
  readonly onPress: (tool: LogToolId) => void;
};

/**
 * The Logs tool's vertical toolbar (the mock's `.panel__tools`, shell-regions.js 314-320): 28 px ghost icon buttons, 4 px apart, one Tab stop with the arrows of a column, Home and End. A toggle keeps its one
 * name and says its state in `aria-pressed`; a button that cannot apply stays focusable and says why (its description and the second line of its tooltip). The mock's toolbar is `role="toolbar"`; the kit's
 * roving group is a named `group`, which is what the panel's own actions are, and which the kit's contract keeps (docs/ui-next/status/P1b-4a.md).
 */
export function LogToolbar({ tools, onPress }: LogToolbarProps) {
  return (
    <RovingGroup label={LOG_TOOLS_LABEL} kind="column" gap={4} align="center">
      {tools.map((tool) => (
        <IconButton
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          variant="ghost"
          pressed={tool.pressed}
          disabledReason={tool.disabledReason}
          data-log-tool={tool.id}
          {...tip(tipOf(tool))}
          onClick={() => {
            onPress(tool.id);
          }}
        />
      ))}
    </RovingGroup>
  );
}
