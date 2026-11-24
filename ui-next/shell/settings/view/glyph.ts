import { isIconName, type IconName } from '@omniviewdev/kit';

/**
 * The kit's glyph for the one the host names for a settings category. The host names it as the SDK does (`LuSettings2`, `LuSquareTerminal`: `internal/settings/*.go`), and the kit names the glyphs it took from that set in
 * lower-case words joined by hyphens (`settings-2`, `square-terminal`), so the name is the words after `Lu`, split where a capital or a digit starts. Nothing when the kit has no such glyph: the nav then draws none, and never a stand-in.
 */
export function kitGlyphOf(name: string): IconName | undefined {
  const words = /^Lu([A-Z][A-Za-z0-9]*)$/.exec(name)?.[1];
  if (words === undefined) {
    return undefined;
  }

  const kit = words.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
  return isIconName(kit) ? kit : undefined;
}
