// The notices and operations model (design chapter 16 section E): see the README. Nothing imports this folder yet.
export { createNoticesStore } from './store';
export type { NoticesOptions, NoticesStore, Restored, Selectors } from './store';
export { createNoticesSaver } from './saver';
export type { NoticesSaverOptions, Saver } from './saver';
export { MIGRATIONS, restoreNotices, serialiseNotices } from './persist';
export type { RestoreOptions, RestoreResult } from './persist';
export { noticeFromHostError } from './error';
export * from './types';
