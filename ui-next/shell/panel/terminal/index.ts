// The Terminal tool of the host (docs/ui-next/status/T1.md): what the shell exports of it.
export { createTerminals } from './terminals';
export type { Terminals, TerminalsOptions, TerminalsRestored } from './terminals';
export { SCREEN_READER_COMMAND, screenReaderSaid } from './screenReader';
export type { ScreenReaderChoice } from './screenReader';
export { TERMINAL_TOOL, TERMINAL_TOOL_ID } from './tool';
export type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalTarget } from './feed';
export type { Engine, EngineLoader, EngineOptions } from './engine';
export { loadPageKey, terminalKeyStorage } from './pageKey';
export type { KeyStorage, KeyStorageOptions } from './pageKey';
export { attachLocalTerminal, restoreLocalTerminals } from './localShell';
