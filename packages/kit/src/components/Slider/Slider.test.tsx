import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';
import { Slider, type SliderProps } from './Slider';
import * as examples from './Slider.examples';

const slider = (props: Partial<SliderProps> = {}) => <Slider label="Opacity" value={62} unit="%" {...props} />;
const range = () => screen.getByRole<HTMLInputElement>('slider');
const pointer = { button: 0, isPrimary: true, pointerId: 7 };
const move = (value: number) => fireEvent.input(range(), { target: { value: String(value) } });

describe('Slider', () => {
  it('exposes one labelled native range and one visual, non-live readout', () => {
    const { rerender } = render(slider({ min: 0.25, max: 2, step: 0.25, value: 1.5, unit: '×' }));
    const input = screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' });
    expect(input.type).toBe('range');
    expect([input.min, input.max, input.step, input.valueAsNumber, input.tabIndex]).toEqual(['0.25', '2', '0.25', 1.5, 0]);
    expect(input.getAttribute('aria-valuetext')).toBe('1.5×');
    expect(screen.getByText('1.5×').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
    rerender(slider({ value: 0, unit: undefined }));
    expect(input.valueAsNumber).toBe(0);
    expect(input.hasAttribute('aria-valuetext')).toBe(false);
    rerender(slider({ value: 100 }));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('displays every discrete stop and reports its label instead of its index throughout a gesture', () => {
    const labels = ['80%', '90%', '100%', '110%', '125%'];
    const onCommit = vi.fn();
    render(<Slider label="Scale" value={2} min={0} max={4} step={1} stopLabels={labels} onCommit={onCommit} />);
    const marks = document.querySelector('[data-ov-part="stops"]');
    expect([...marks!.children].map(mark => mark.textContent)).toEqual(labels);
    expect(range().getAttribute('aria-valuetext')).toBe('100%');
    fireEvent.pointerDown(range(), pointer);
    move(4);
    expect(range().getAttribute('aria-valuetext')).toBe('125%');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(range(), pointer);
    expect(onCommit.mock.calls).toEqual([[4]]);
  });

  it('uses its Field label, help, error and disabled reason without duplicating them', () => {
    render(
      <Field label="Content opacity" help="Canvas" message={{ kind: 'error', text: 'Could not save.' }} disabledReason="Locked here.">
        {slider()}
      </Field>,
    );
    const input = screen.getByRole<HTMLInputElement>('slider', { name: 'Content opacity' });
    expect(input.hasAttribute('aria-label')).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.disabled).toBe(false);
    const descriptions = (input.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent).join(' ');
    expect(descriptions).toContain('Canvas');
    expect(descriptions).toContain('Could not save.');
    expect(descriptions.match(/Locked here\./g)).toHaveLength(1);
  });

  it.each(['mouse', 'touch', 'pen'])('previews a %s gesture locally and commits once, including release outside the control', pointerType => {
    const onValueChange = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(slider({ onValueChange, onCommit }));
    fireEvent.pointerDown(range(), { ...pointer, pointerType });
    for (const value of [63, 78, 97, 100]) {
      move(value);
    }

    expect(screen.getByText('100%')).toBeTruthy();
    expect(range().getAttribute('aria-valuetext')).toBe('100%');
    expect(onValueChange.mock.calls).toEqual([[63], [78], [97], [100]]);
    fireEvent.pointerUp(document.body, { pointerId: 8 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(document.body, pointer);
    fireEvent.change(range());
    fireEvent.blur(range());
    expect(onCommit.mock.calls).toEqual([[100]]);
    // The caller owns the accepted value, including a refusal or a later echo from another window.
    expect(range().valueAsNumber).toBe(62);
    rerender(slider({ onCommit, value: 100 }));
    expect(range().valueAsNumber).toBe(100);
  });

  it('does not write for a click on the thumb or a trip back to the starting point', () => {
    const onCommit = vi.fn();
    render(slider({ onCommit }));
    fireEvent.pointerDown(range(), pointer);
    fireEvent.pointerUp(range(), pointer);
    fireEvent.pointerDown(range(), pointer);
    move(90);
    move(62);
    fireEvent.pointerUp(range(), pointer);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])(
    'lets the browser step on %s and submits held-key repeats only on the matching release', key => {
      const onCommit = vi.fn();
      render(slider({ onCommit }));
      // jsdom does not implement the range default action. Supply the input events that follow native keydown.
      expect(fireEvent.keyDown(range(), { key })).toBe(true);
      move(63);
      fireEvent.keyDown(range(), { key, repeat: true });
      move(64);
      fireEvent.keyUp(range(), { key: 'Shift' });
      expect(onCommit).not.toHaveBeenCalled();
      fireEvent.keyUp(range(), { key });
      expect(onCommit.mock.calls).toEqual([[64]]);
    },
  );

  it('consumes Escape during a gesture, drops trailing inputs, and leaves idle Escape to the enclosing dialog', () => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    const escape = vi.fn();
    const view = (value: number) => (
      <div onKeyDown={event => {
        if (event.key === 'Escape') {
          escape();
        }
      }}>
        {slider({ value, onValueChange, onCommit })}
      </div>
    );
    const { rerender } = render(view(62));
    fireEvent.pointerDown(range(), pointer);
    move(90);
    rerender(view(47));
    expect(range().valueAsNumber).toBe(90);
    fireEvent.keyDown(range(), { key: 'Escape' });
    expect(escape).not.toHaveBeenCalled();
    expect(onValueChange.mock.calls).toEqual([[90], [47]]);
    move(91);
    fireEvent.pointerUp(range(), pointer);
    expect(range().valueAsNumber).toBe(47);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(range(), { key: 'Escape' });
    expect(escape).toHaveBeenCalledOnce();
  });

  it('does not restart a canceled keyboard gesture on auto-repeat, and accepts the next independent adjustment', () => {
    const onCommit = vi.fn();
    render(slider({ onCommit }));
    fireEvent.keyDown(range(), { key: 'ArrowRight' });
    move(63);
    fireEvent.keyDown(range(), { key: 'Escape' });
    expect(fireEvent.keyDown(range(), { key: 'ArrowRight', repeat: true })).toBe(false);
    move(64);
    fireEvent.keyUp(range(), { key: 'ArrowRight' });
    expect(range().valueAsNumber).toBe(62);
    expect(onCommit).not.toHaveBeenCalled();
    move(67);
    expect(onCommit.mock.calls).toEqual([[67]]);
  });

  it('uses the current commit callback if its owner changes during a drag', () => {
    const previous = vi.fn();
    const current = vi.fn();
    const { rerender } = render(slider({ onCommit: previous }));
    fireEvent.pointerDown(range(), pointer);
    move(42);
    rerender(slider({ onCommit: current, value: 61 }));
    fireEvent.pointerUp(range(), pointer);
    expect(previous).not.toHaveBeenCalled();
    expect(current.mock.calls).toEqual([[42]]);
  });

  it('discards a canceled pointer, blur, hidden document or unmount without a late commit', () => {
    const onCommit = vi.fn();
    const { unmount } = render(slider({ onCommit }));
    for (const interrupt of [
      () => fireEvent.pointerCancel(range(), pointer),
      () => fireEvent.blur(range()),
      () => fireEvent.blur(window),
      () => {
        const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        try {
          fireEvent(document, new Event('visibilitychange'));
        } finally {
          hidden.mockRestore();
        }
      },
    ]) {
      fireEvent.pointerDown(range(), pointer);
      move(81);
      interrupt();
      fireEvent.pointerUp(document.body, pointer);
      expect(range().valueAsNumber).toBe(62);
    }

    fireEvent.pointerDown(range(), pointer);
    move(93);
    unmount();
    fireEvent.pointerUp(document.body, pointer);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels on an inherited lock and cannot revive the gesture if the lock lifts before release', () => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    const view = (readOnly: boolean) => <Field label="Opacity" readOnly={readOnly}>{slider({ onCommit, onValueChange })}</Field>;
    const { rerender } = render(view(false));
    fireEvent.pointerDown(range(), pointer);
    move(96);
    rerender(view(true));
    expect(range().getAttribute('aria-readonly')).toBe('true');
    expect(range().valueAsNumber).toBe(62);
    rerender(view(false));
    expect(range().valueAsNumber).toBe(62);
    move(95);
    fireEvent.pointerUp(range(), pointer);
    expect(onValueChange.mock.calls).toEqual([[96], [62]]);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerDown(range(), pointer);
    move(85);
    fireEvent.pointerUp(range(), pointer);
    expect(onCommit.mock.calls).toEqual([[85]]);
  });

  it.each([{ readOnly: true }, { disabledReason: 'Unavailable.' }])('keeps a locked slider focusable and ignores every change path', lock => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    render(slider({ ...lock, onValueChange, onCommit }));
    range().focus();
    expect(document.activeElement).toBe(range());
    fireEvent.pointerDown(range(), pointer);
    move(63);
    fireEvent.pointerUp(range(), pointer);
    expect(fireEvent.keyDown(range(), { key: 'ArrowRight' })).toBe(false);
    fireEvent.change(range(), { target: { value: '65' } });
    fireEvent.keyUp(range(), { key: 'ArrowRight' });
    expect(range().valueAsNumber).toBe(62);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('accepts standalone input and change actions from assistive technology, without a pointer or key sequence', () => {
    const onCommit = vi.fn();
    const onValueChange = vi.fn();
    render(slider({ onCommit, onValueChange }));
    move(70);
    fireEvent.change(range());
    fireEvent.change(range(), { target: { value: '80' } });
    expect(onValueChange.mock.calls).toEqual([[70], [80]]);
    expect(onCommit.mock.calls).toEqual([[70], [80]]);
  });

  for (const [name, Example] of Object.entries(examples)) {
    it(`renders accessible example ${name}`, async () => {
      const { container } = render(<Example />);
      expect(range()).toBeTruthy();
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(result.violations.map(violation => violation.id)).toEqual([]);
    });
  }
});
