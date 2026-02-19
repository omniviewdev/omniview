// Auto-generated shim for '@dnd-kit/core'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@dnd-kit/core'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@dnd-kit/core" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const KeyboardCode = mod.KeyboardCode;
export const AutoScrollActivator = mod.AutoScrollActivator;
export const TraversalOrder = mod.TraversalOrder;
export const MeasuringStrategy = mod.MeasuringStrategy;
export const MeasuringFrequency = mod.MeasuringFrequency;
export const DndContext = mod.DndContext;
export const DragOverlay = mod.DragOverlay;
export const KeyboardSensor = mod.KeyboardSensor;
export const MouseSensor = mod.MouseSensor;
export const PointerSensor = mod.PointerSensor;
export const TouchSensor = mod.TouchSensor;
export const applyModifiers = mod.applyModifiers;
export const closestCenter = mod.closestCenter;
export const closestCorners = mod.closestCorners;
export const defaultAnnouncements = mod.defaultAnnouncements;
export const defaultCoordinates = mod.defaultCoordinates;
export const defaultDropAnimation = mod.defaultDropAnimation;
export const defaultDropAnimationSideEffects = mod.defaultDropAnimationSideEffects;
export const defaultKeyboardCoordinateGetter = mod.defaultKeyboardCoordinateGetter;
export const defaultScreenReaderInstructions = mod.defaultScreenReaderInstructions;
export const getClientRect = mod.getClientRect;
export const getFirstCollision = mod.getFirstCollision;
export const getScrollableAncestors = mod.getScrollableAncestors;
export const pointerWithin = mod.pointerWithin;
export const rectIntersection = mod.rectIntersection;
export const useDndContext = mod.useDndContext;
export const useDndMonitor = mod.useDndMonitor;
export const useDraggable = mod.useDraggable;
export const useDroppable = mod.useDroppable;
export const useSensor = mod.useSensor;
export const useSensors = mod.useSensors;

export default mod.default !== undefined ? mod.default : mod;
