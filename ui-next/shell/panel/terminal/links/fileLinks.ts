// The file-link matcher (#696 step 2): which `file[:line[:col]]` candidates a line of terminal text holds. A pure module: no emulator, no I/O, no file system. Whether a candidate is a file is Go's answer (`ResolveLink`, step 3).

/** The caps of the issue. A line over `maxLineLength` has no file links; a path over `maxPathLength` is never resolved; a link (the path and its suffix) over `maxLinkLength` is ignored; a line gives at most `maxLinks`. */
export interface FileLinkLimits {
  readonly maxLineLength: number;
  readonly maxLinks: number;
  readonly maxPathLength: number;
  readonly maxLinkLength: number;
}

export const FILE_LINK_LIMITS: FileLinkLimits = Object.freeze({ maxLineLength: 2000, maxLinks: 10, maxPathLength: 1024, maxLinkLength: 500 });

export interface FileLinkCandidate {
  readonly start: number;
  readonly end: number;
  readonly startCell: number;
  readonly endCell: number;
  readonly path: string;
  readonly line?: number;
  readonly col?: number;
  readonly lineEnd?: number;
  readonly colEnd?: number;
  readonly diffPrefix?: string;
}

export interface FindFileLinksOptions {
  readonly limits?: Partial<FileLinkLimits>;
  readonly onStep?: () => void;
  readonly cellWidth?: (codePoint: number) => number;
}

export function cellWidth(codePoint: number): number {
  return codePoint;
}

export function findFileLinks(_text: string, _options: FindFileLinksOptions = {}): FileLinkCandidate[] {
  return [];
}
