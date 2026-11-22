// What the host's settings service answers, as far as Settings reads it (`backend/pkg/settings/service.go`: `GetSnapshot`, `Validate`, `Commit`; the SDK's `settings` package: `Category`, `Setting`). Structural
// types, not the generated classes: the model below is plain TypeScript over plain data, so a test builds a snapshot as an object and the generated classes satisfy these as they are.

/** The SDK's setting types (`settings.SettingType`), as the wire says them: `text`, `select`, `multiselect`, `integer`, `float`, `toggle`, `color`, `datetime`, `password`. A type this build does not know is read as it is. */
export type HostSettingType = string;

export type HostOption = { readonly value: unknown; readonly label: string; readonly description?: string | undefined };

export type HostFileSelection = { readonly enabled: boolean; readonly allowFolders: boolean; readonly extensions?: readonly string[] | null | undefined; readonly multiple: boolean; readonly relative: boolean };

export type HostSetting = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly type: HostSettingType;
  /** The value in effect. `null` for a sensitive setting: the host never sends one. */
  readonly value?: unknown;
  /** `null` for a sensitive setting. */
  readonly default?: unknown;
  readonly options?: readonly HostOption[] | null | undefined;
  readonly fileSelection?: HostFileSelection | null | undefined;
  readonly sensitive?: boolean | undefined;
  readonly devOnly?: boolean | undefined;
  readonly requiresRestart?: boolean | undefined;
  readonly pendingRestart?: boolean | undefined;
};

export type HostCategory = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** A glyph name of the SDK (`LuSettings2`): the view draws it when the kit has the glyph, and none when it has not. */
  readonly icon: string;
  readonly settings: Readonly<Record<string, HostSetting | undefined>>;
};

export type HostSnapshot = {
  readonly categories: Readonly<Record<string, HostCategory | undefined>>;
  /** Which sensitive settings hold a value, by the id a commit takes (`category.setting`): the host's own fact, never the value (`Snapshot.Stored`). */
  readonly stored?: Readonly<Record<string, boolean | undefined>> | undefined;
};

/** What the host answers to a check of one value (`settings.ValidationResult`): `message` is "safe to show in settings forms". */
export type HostValidation = { readonly valid: boolean; readonly code?: string | undefined; readonly message?: string | undefined };

/** What the host answers to a commit (`CommitResult`): the snapshot after it, and whether the live effect took (`applied`, `uncertain`). */
export type HostCommit = { readonly snapshot: HostSnapshot; readonly applied: boolean; readonly uncertain: boolean; readonly message: string };

/** The host's settings service as Settings needs it: a seam, so that a test and the probe's fixture answer from memory. The production one is `runtime.ts`. */
export type SettingsClient = {
  readonly snapshot: () => Promise<HostSnapshot>;
  readonly validate: (id: string, value: unknown) => Promise<HostValidation>;
  readonly commit: (values: Readonly<Record<string, unknown>>) => Promise<HostCommit>;
  /** Listens for a change of the host's settings that someone made (this window or another). Answers the function that stops it. */
  readonly onChanged: (listener: () => void) => () => void;
};

/** What the host's window service says of the Settings window (`backend/window/types.go`: `SettingsState`): the request to show it (a new `requestId` for each new target) and whether it is shown. */
export type SettingsRequest = {
  readonly requestId: number;
  readonly target: string;
  readonly visible: boolean;
};

/** The host's window service as the Settings window uses it: what it was last asked, the event of each request and each show or hide, and hiding it (the window is kept, `HideSettings`). */
export type SettingsWindowClient = {
  readonly state: () => Promise<SettingsRequest>;
  readonly onState: (listener: (request: SettingsRequest) => void) => () => void;
  readonly hide: () => Promise<void>;
};
