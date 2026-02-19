import HotkeyHint from './HotkeyHint';

export interface KbdProps {
  shortcut: string;
}

export default function Kbd({ shortcut }: KbdProps) {
  const keys = shortcut.split('+').map((k) => k.trim());
  return <HotkeyHint keys={keys} />;
}

Kbd.displayName = 'Kbd';
