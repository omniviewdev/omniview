// What the new tree's tests need of the browser that jsdom does not have. The kit's hosts (the one tooltip and the one hover card of the window) are popover elements and throw in an engine without
// the Popover API; the shell mounts the hover card with every panel, so every test that draws a shell with one needs these two methods. A stand-in that only marks the element, never a layout:
// what a popover does in a real engine is the probes' to prove, not jsdom's.
if (typeof HTMLElement.prototype.showPopover !== 'function') {
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    this.setAttribute('data-test-popover-open', '');
  };

  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    this.removeAttribute('data-test-popover-open');
  };
}
