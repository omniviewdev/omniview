import { Component, type ReactNode } from 'react';

type Props = { readonly id: string; readonly selected: string; readonly children: ReactNode };
type Focus = { readonly node: Element; readonly trigger?: Element };

/** Capture the actual focused node before React removes it, including a popup belonging to the detail trigger. */
export class DetailFocus extends Component<Props> {
  getSnapshotBeforeUpdate(): Focus | null {
    const active = document.activeElement;
    if (!active || active === document.body || document.hidden) {
      return null;
    }

    const panel = document.getElementById(`${this.props.id}-panel`);
    const popup = active.closest('[role="menu"]');
    if (popup?.id) {
      const trigger = [...panel?.querySelectorAll('[aria-haspopup="menu"][aria-controls]') ?? []].find(t => t.getAttribute('aria-controls') === popup.id);
      if (trigger) {
        return { node: active, trigger };
      }
    }

    if (panel && (panel.contains(active) || (active.getAttribute('role') === 'tab' && active.getAttribute('aria-controls') === panel.id))) {
      return { node: active };
    }

    return null;
  }

  componentDidUpdate(before: Props, _state: unknown, focused: Focus | null): void {
    if (!focused) {
      return;
    }

    const restore = () => {
      const active = document.activeElement;
      const panel = `${this.props.id}-panel`;
      const lost = !focused.node.isConnected || (before.selected !== this.props.selected && focused.node.id === panel);
      if (!lost || document.hidden || (active !== document.body && active?.id !== panel)) {
        return;
      }

      const target = document.getElementById(`${this.props.id}-tab-${this.props.selected}`);
      const slot = target?.closest<HTMLElement>('[data-page-slot]');
      if (slot?.style.display !== 'none') {
        target?.focus({ preventScroll: true });
      }
    };

    // MenuHost defers dismissing an unregistered opener until after layout cleanup. Let it release its portal first.
    if (focused.trigger && !focused.trigger.isConnected && focused.node.isConnected) {
      queueMicrotask(restore);
    } else {
      restore();
    }
  }

  render(): ReactNode {
    return this.props.children;
  }
}
