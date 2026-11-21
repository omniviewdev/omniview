// The labels and counts of the sidebar's long-name comparison (step S3, demo finding D7): the one list the mock's measurer (mock-sidebar-measure.mjs) and the strip probe (strip-probe.mjs, section `names`) both read, so
// the mock and the shell draw the same rows. The words are neutral (this folder names no plugin), and their widths in the normalized font (Helvetica 13 px: the probes' font on both sides) fall on either side of the rooms
// a label gets in the 244 px sidebar at a depth of two, beside a count: a label that fits in every room (Items), one that fits the room of a count of three characters and not the room the shell held before this step
// (Resource definitions list, 137 px against 140.7 and 133.1), one that fits only the room of a short count (Ingress controller classes, 147 px), one that fits the room of a one-digit count and no other (Scaling policies
// list entries, 152 px) and one that is cut in every room (Workload disruption budgets, 165 px).
export const NAMES_LABELS = ['Items', 'Resource definitions list', 'Ingress controller classes', 'Scaling policies list entries', 'Workload disruption budgets'];

/** The counts a row may carry: the text the mock is given and what the shell is given for it (an estimate is drawn with a tilde and named "about"). The last is the commonest count a window shows, an estimate of two digits. */
export const NAMES_COUNTS = [
  { text: '5', value: 5 },
  { text: '12', value: 12 },
  { text: '123', value: 123 },
  { text: '~12', value: 12, approximate: true },
];
