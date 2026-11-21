import { describe, expect, it, vi } from 'vitest';
import { createCentre } from './centreControl';

// The notification centre's controller (ch16 S80; the mock's `Shell.feedback.openCenter` and `Shell.state.feedback.center`): whether the centre is open, and the source its list is narrowed to. It is outside React
// because the model's seam calls it (the summary toast's Show asks the host to open the centre) and so does a command; the view reads it and draws.

describe('the centre controller', () => {
  it('starts closed, with no source chosen', () => {
    expect(createCentre().getSnapshot()).toEqual({ open: false, source: '' });
  });

  it('opens, closes and toggles, and tells each listener once for each change', () => {
    const centre = createCentre();
    const heard = vi.fn();
    centre.subscribe(heard);
    centre.open();
    expect(centre.getSnapshot().open).toBe(true);
    centre.close();
    expect(centre.getSnapshot().open).toBe(false);
    centre.toggle();
    expect(centre.getSnapshot().open).toBe(true);
    centre.toggle();
    expect(centre.getSnapshot().open).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it('tells nobody when nothing changed, and keeps the snapshot object', () => {
    const centre = createCentre();
    const before = centre.getSnapshot();
    const heard = vi.fn();
    centre.subscribe(heard);
    centre.close();
    centre.filter('');
    expect(heard).not.toHaveBeenCalled();
    expect(centre.getSnapshot()).toBe(before);
    centre.open();
    const open = centre.getSnapshot();
    centre.open();
    expect(centre.getSnapshot()).toBe(open);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps the source it was narrowed to across a close and an open, as the mock keeps it', () => {
    const centre = createCentre();
    centre.open();
    centre.filter('cloud');
    centre.close();
    expect(centre.getSnapshot()).toEqual({ open: false, source: 'cloud' });
    centre.open();
    expect(centre.getSnapshot()).toEqual({ open: true, source: 'cloud' });
    centre.filter('');
    expect(centre.getSnapshot().source).toBe('');
  });

  it('stops telling a listener that unsubscribed, and tells the others', () => {
    const centre = createCentre();
    const first = vi.fn();
    const second = vi.fn();
    const stop = centre.subscribe(first);
    centre.subscribe(second);
    centre.open();
    stop();
    centre.close();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('answers the same functions for as long as it lives, so a view that holds them never draws again for them', () => {
    const centre = createCentre();
    const { open, close, toggle, filter } = centre;
    open();
    close();
    toggle();
    filter('x');
    expect(centre.open).toBe(open);
    expect(centre.close).toBe(close);
    expect(centre.toggle).toBe(toggle);
    expect(centre.filter).toBe(filter);
  });
});
