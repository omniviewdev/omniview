import type { CommandState } from './words';
import styles from './Glyph.module.css';

// The mark of a command, as DOM (issue #694 step 5): painted into the element the emulator hands for a decoration, as many times as the emulator draws it anew or the command's state changes. The element is the emulator's,
// so nothing here keeps it: each paint replaces what is in it. It is not in the accessibility tree (a node for each command of a thousand would bury a screen reader): what a person who cannot see it hears is the words of a jump
// (`words.ts`), and its actions are the terminal's menu and keys.

const SVG = 'http://www.w3.org/2000/svg';

/** The drawing of each state, in a 10 by 10 box: a check in a circle, a cross in a circle, an open ring, and a dash in a circle. */
const SHAPES: Readonly<Record<CommandState, readonly string[]>> = {
  success: ['circle:5,5,4', 'path:M3 5.2 L4.6 6.8 L7.2 3.6'],
  failure: ['circle:5,5,4', 'path:M3.6 3.6 L6.4 6.4 M6.4 3.6 L3.6 6.4'],
  running: ['circle:5,5,4;dash'],
  incomplete: ['circle:5,5,4', 'path:M3.2 5 L6.8 5'],
};

function shapeOf(spec: string): SVGElement {
  const [kind = '', rest = ''] = spec.split(':');
  if (kind === 'circle') {
    const [numbers = '', flag] = rest.split(';');
    const [cx = '5', cy = '5', r = '4'] = numbers.split(',');
    const circle = document.createElementNS(SVG, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    if (flag === 'dash') {
      circle.setAttribute('stroke-dasharray', '2 2');
    }

    return circle;
  }

  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', rest);
  return path;
}

/**
 * Fills `element` with the mark of a command in `state`. `hover` is told where the mark is (its box, in the pixels of the window) when the pointer comes onto it and `undefined` when it leaves.
 */
export function paintGlyph(element: HTMLElement, state: CommandState, hover: (box: DOMRect | undefined) => void): void {
  element.classList.add(styles.decoration ?? 'decoration');
  const glyph = document.createElement('span');
  glyph.className = styles.glyph ?? 'glyph';
  glyph.dataset.state = state;
  glyph.setAttribute('aria-hidden', 'true');
  const drawing = document.createElementNS(SVG, 'svg');
  drawing.setAttribute('viewBox', '0 0 10 10');
  for (const spec of SHAPES[state]) {
    drawing.append(shapeOf(spec));
  }

  glyph.append(drawing);
  glyph.addEventListener('mouseenter', () => {
    hover(glyph.getBoundingClientRect());
  });
  glyph.addEventListener('mouseleave', () => {
    hover(undefined);
  });
  element.replaceChildren(glyph);
}
