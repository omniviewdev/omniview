// The host's Logs tool: what a plugin hands over to open a session (`LogTarget`), the registry that owns the feeds (`createLogStreams`), the body that draws one (`LogsBody`) and the words of the
// tool, its card and its empty state. docs/ui-next/status/P1b-3a.md says how they fit together.
export { logCardOf } from './card';
export type { LogFeedHandle, LogFeedHandleSnapshot, LogSourceName, LogTarget } from './feed';
export { createLogStreams } from './LogStreams';
export type { LogOpened, LogSessionRecord, LogStreams, LogStreamsOptions } from './LogStreams';
export { LogsBody } from './LogsBody';
export { causeSentence, sessionStateOf, stateWords } from './state';
export { LOGS_EMPTY, LOGS_TOOL, LOGS_TOOL_ID } from './tool';
export { completeLogCard } from './card';
