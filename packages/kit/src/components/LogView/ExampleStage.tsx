import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The box a log example sits in; `boxClass` is the CSS Module class that gives it its size. It mounts what it holds when it comes near the screen, not with the page. A log
 * view's first measure changes its store in a layout effect, which React renders again at once and in the same task, and the parts page mounts every example in one commit:
 * eleven log views in it are believed to have held the main thread long enough on a CI runner for kit-probe.mjs (`busy`, the loader of a button that comes after one second) to
 * read a loader that came early (799 to 885 ms after the icon, three runs of three). Not measured: the fix is the reasoning's, and CI is its check. Without an
 * IntersectionObserver (a test) it mounts at once. Internal to the examples: it is not a part and is not exported from the kit.
 */
export function ExampleStage({ boxClass, children }: { readonly boxClass: string | undefined; readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = box.current;
    if (element === null || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={box} className={boxClass}>
      {near ? children : null}
    </div>
  );
}
