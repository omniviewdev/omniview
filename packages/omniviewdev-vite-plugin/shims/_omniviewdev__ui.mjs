// Auto-generated shim for '@omniviewdev/ui'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const ActionCard = mod.ActionCard;
export const AspectRatio = mod.AspectRatio;
export const Avatar = mod.Avatar;
export const Badge = mod.Badge;
export const Card = mod.Card;
export const Chip = mod.Chip;
export const CircularProgress = mod.CircularProgress;
export const ClipboardText = mod.ClipboardText;
export const DetailsCard = mod.DetailsCard;
export const Divider = mod.Divider;
export const EmptySearch = mod.EmptySearch;
export const ExpandableSection = mod.ExpandableSection;
export const ExpandableSections = mod.ExpandableSections;
export const FileIcon = mod.FileIcon;
export const HotkeyHint = mod.HotkeyHint;
export const Icon = mod.Icon;
export const InlineEdit = mod.InlineEdit;
export const KVCard = mod.KVCard;
export const Kbd = mod.Kbd;
export const LinearProgress = mod.LinearProgress;
export const List = mod.List;
export const ListCard = mod.ListCard;
export const ListDivider = mod.ListDivider;
export const ListItem = mod.ListItem;
export const ListSubheader = mod.ListSubheader;
export const LoadingOverlay = mod.LoadingOverlay;
export const MediaCard = mod.MediaCard;
export const MetricsSection = mod.MetricsSection;
export const OverflowText = mod.OverflowText;
export const StatCard = mod.StatCard;
export const StatusCard = mod.StatusCard;
export const TruncatedList = mod.TruncatedList;

export default mod.default !== undefined ? mod.default : mod;
