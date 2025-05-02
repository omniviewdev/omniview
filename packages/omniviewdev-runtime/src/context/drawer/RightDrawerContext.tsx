import { createContext } from 'react';
import { DrawerComponent, DrawerContext } from './types';

export interface RightDrawerContextType {
  openDrawer: (component: DrawerComponent, ctx: DrawerContext) => void;
  closeDrawer: () => void;
  isOpen: boolean;
}

export const RightDrawerContext = createContext<RightDrawerContextType | undefined>(undefined);
//
// export const DrawerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
//   const [currentComponent, setCurrentComponent] = useState<DrawerComponent>(null);
//   const [isOpen, setIsOpen] = useState(false);
//
//   const openDrawer = (component: DrawerComponent) => {
//     setCurrentComponent(component);
//     setIsOpen(true);
//   };
//
//   const closeDrawer = () => {
//     setIsOpen(false);
//     // Delay clearing component until drawer closes to avoid flicker
//     setTimeout(() => setCurrentComponent(null), 200); // match transition duration
//   };
//
//   return (
//     <DrawerContext.Provider value={{ openDrawer, closeDrawer, isOpen, currentComponent }}>
//       {children}
//     </DrawerContext.Provider>
//   );
// };
