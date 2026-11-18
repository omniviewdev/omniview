// The guard behind the rule "no write to the document root" (docs/ui-next/AGENTS.md, working rule 4), for the tests of the kit's parts: the names of the attributes of `<html>` that `run`
// wrote, one for each write, in order. The style attribute is one of them, so a custom property set on the root shows as a write of `style`.
//
// A MutationObserver delivers its records in a microtask, and `disconnect()` throws away the records it has not delivered yet (DOM Standard, "disconnect"). A test that runs its code
// synchronously and disconnects at once would therefore see nothing, whatever the code wrote: the records still queued are taken before the observer goes (`rootWrites.test.ts`
// shows the difference). A write that puts the value back is still a write: it is counted.

/** The attributes of the document root that `run` wrote, one name per write. Empty when it wrote none. */
export function rootWrites(run: () => void): string[] {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => {
    records.push(...list);
  });
  observer.observe(document.documentElement, { attributes: true });
  try {
    run();
  } finally {
    records.push(...observer.takeRecords());
    observer.disconnect();
  }

  return records.map((record) => record.attributeName ?? '');
}
