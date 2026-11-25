import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormActions } from './FormActions';

const noop = () => undefined;

describe('FormActions', () => {
  it('is one group with no label of its own, and its commands are Tab stops in the order lead, Cancel, secondaries, primary', () => {
    render(
      <FormActions
        lead="2 changes"
        cancel={{ label: 'Cancel', onSelect: noop }}
        secondary={[
          { label: 'Save draft', onSelect: noop },
          { label: 'Preview', onSelect: noop },
        ]}
        primary={{ label: 'Publish', onSelect: noop }}
      />,
    );
    const group = screen.getByRole('group');
    expect(group.hasAttribute('aria-label')).toBe(false);
    expect(group.hasAttribute('aria-labelledby')).toBe(false);
    expect([...group.children].map((child) => child.textContent)).toEqual(['2 changes', 'Cancel', 'Save draft', 'Preview', 'Publish']);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Save draft', 'Preview', 'Publish']);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('tabindex')).toBeNull();
    }
  });

  it('has no lead and no Cancel unless it is given them, and nothing is a stop in an empty lane', () => {
    render(<FormActions primary={{ label: 'Save', onSelect: noop }} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Save']);
    expect(screen.getByRole('group').children).toHaveLength(1);
  });

  it('asks for the command that is pressed, once and with nothing, and for no other', () => {
    const cancel = vi.fn();
    const draft = vi.fn();
    const publish = vi.fn();
    render(
      <FormActions cancel={{ label: 'Cancel', onSelect: cancel }} secondary={[{ label: 'Save draft', onSelect: draft }]} primary={{ label: 'Publish', onSelect: publish }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it('keeps a command that is unavailable for a reason in the Tab order, does nothing, and says why', () => {
    const onSelect = vi.fn();
    render(<FormActions primary={{ label: 'Create', onSelect, disabledReason: 'Enter a name first' }} />);
    const button = screen.getByRole('button', { name: 'Create', description: 'Enter a name first' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says that the primary is busy at once, and fills only the primary with the error role when the lane is a danger lane', () => {
    render(<FormActions tone="danger" secondary={[{ label: 'Archive', onSelect: noop }]} primary={{ label: 'Remove', onSelect: noop, busy: true }} />);
    const primary = screen.getByRole('button', { name: 'Remove' });
    expect(primary.getAttribute('aria-busy')).toBe('true');
    expect(primary).toHaveProperty('dataset.ovVariant', 'primary');
    expect(primary).toHaveProperty('dataset.ovTone', 'danger');
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveProperty('dataset.ovTone', 'neutral');
  });

  it('takes the focus on Cancel or on the primary when it mounts, and on nothing when it is not asked to', () => {
    const lane = (autoFocus?: 'cancel' | 'primary') => (
      <FormActions autoFocus={autoFocus} cancel={{ label: 'Cancel', onSelect: noop }} primary={{ label: 'Remove', onSelect: noop }} />
    );
    const none = render(lane());
    expect(document.activeElement).toBe(document.body);
    none.unmount();
    const cancel = render(lane('cancel'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    cancel.unmount();
    render(lane('primary'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove' }));
  });
});
