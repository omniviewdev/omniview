import type { NavSection } from '@omniviewdev/ui/sidebars';
import { CommandPalette } from '@omniviewdev/ui/editors';
import { useResourceCommandPalette } from '../../hooks/useResourceCommandPalette';

interface ResourceCommandPaletteProps {
  connectionID: string;
  layout: NavSection[];
  onNavigate: (resourceID: string) => void;
}

export default function ResourceCommandPalette({ connectionID, layout, onNavigate }: ResourceCommandPaletteProps) {
  const { open, handleClose, handleSelect, items, categories, recentItems } = useResourceCommandPalette({
    connectionID,
    layout,
    onSelect: onNavigate,
  });

  return (
    <CommandPalette
      open={open}
      onClose={handleClose}
      items={items}
      onSelect={handleSelect}
      placeholder="Go to resource type..."
      categories={categories}
      recentItems={recentItems}
    />
  );
}
