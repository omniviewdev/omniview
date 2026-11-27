import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { boot, cloudPage } from '../core/tabs/testing';
import { Shell } from '../Shell';

// Back and Forward walk the history of the tab on screen. The model is the real one over the fixture world's invented plugins; a page says only which page it is.

function mount() {
  const h = boot({ home: false });
  const [first, second] = h.openAll(['alpha', 'other']);
  h.store.goto(1);
  render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ location }) => <p>{`page ${location.route.kind === 'extension-view' ? location.route.offer : location.route.contribution}`}</p>} empty={null} />);
  return { h, first: first, second: second, user: userEvent.setup() };
}

const back = () => screen.getByRole('button', { name: 'Back' });
const forward = () => screen.getByRole('button', { name: 'Forward' });
const onScreen = () => screen.getAllByText(/^page /).find((element) => element.closest<HTMLElement>('[data-page-slot]')?.style.display !== 'none')?.textContent;

afterEach(() => {
  cleanup();
});

describe('the group', () => {
  it('is a group named Navigation holding Back and Forward, in that order', () => {
    mount();

    const group = screen.getByRole('group', { name: 'Navigation' });
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Back', 'Forward']);
  });
});

describe('with no history', () => {
  it('says why each does nothing, through aria-disabled and a description, and stays focusable', async () => {
    const { user } = mount();

    expect(back()).toHaveAttribute('aria-disabled', 'true');
    expect(back()).toHaveAccessibleDescription('There is no earlier page in this tab');
    expect(forward()).toHaveAttribute('aria-disabled', 'true');
    expect(forward()).toHaveAccessibleDescription('There is no later page in this tab');
    expect(back()).not.toBeDisabled();

    await user.tab();
    expect(back()).toHaveFocus();
    await user.tab();
    expect(forward()).toHaveFocus();
  });

  it('does nothing when it is pressed', async () => {
    const { h, user } = mount();
    const before = h.state();

    await user.click(back());
    await user.click(forward());

    expect(h.state()).toBe(before);
  });
});

describe('with history', () => {
  it('walks the history of the tab on screen: Back to the page before, then Forward again', async () => {
    const { h, first, user } = mount();
    act(() => {
      h.store.navigate(first, cloudPage('beta'));
    });
    expect(onScreen()).toBe('page beta');
    expect(back()).not.toHaveAttribute('aria-disabled');
    expect(back()).not.toHaveAccessibleDescription();
    expect(forward()).toHaveAttribute('aria-disabled', 'true');

    await user.click(back());
    expect(onScreen()).toBe('page alpha');
    expect(back()).toHaveAttribute('aria-disabled', 'true');
    expect(forward()).not.toHaveAttribute('aria-disabled');

    await user.click(forward());
    expect(onScreen()).toBe('page beta');
    expect(h.state().tabs[first]?.history.index).toBe(1);
  });

  it('is the history of the tab on screen, never another\'s: a tab switch changes what they say', () => {
    const { h, first, second } = mount();
    act(() => {
      h.store.navigate(first, cloudPage('beta'));
    });
    expect(back()).not.toHaveAttribute('aria-disabled');

    act(() => {
      h.store.activate(second);
    });
    expect(back()).toHaveAttribute('aria-disabled', 'true');

    act(() => {
      h.store.activate(first);
    });
    expect(back()).not.toHaveAttribute('aria-disabled');
  });

  it('leaves the other tab\'s history where it was', async () => {
    const { h, first, second, user } = mount();
    act(() => {
      h.store.navigate(first, cloudPage('beta'));
      h.store.navigate(second, cloudPage('gamma'));
      h.store.activate(first);
    });

    await user.click(back());

    expect(h.state().tabs[first]?.history.index).toBe(0);
    expect(h.state().tabs[second]?.history.index).toBe(1);
  });

  it('has no earlier or later page while no tab is on screen', () => {
    const { h, first, second } = mount();
    act(() => {
      h.store.navigate(first, cloudPage('beta'));
      h.store.close(second);
      h.store.close(first);
    });

    expect(back()).toHaveAttribute('aria-disabled', 'true');
    expect(forward()).toHaveAttribute('aria-disabled', 'true');
  });
});
