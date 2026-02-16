// Auto-generated shim for 'react-router-dom'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react-router-dom'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react-router-dom" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BrowserRouter = mod.BrowserRouter;
export const HashRouter = mod.HashRouter;
export const Link = mod.Link;
export const MemoryRouter = mod.MemoryRouter;
export const NavLink = mod.NavLink;
export const Navigate = mod.Navigate;
export const Outlet = mod.Outlet;
export const Route = mod.Route;
export const Router = mod.Router;
export const Routes = mod.Routes;
export const ScrollRestoration = mod.ScrollRestoration;
export const UNSAFE_DataRouterContext = mod.UNSAFE_DataRouterContext;
export const UNSAFE_DataRouterStateContext = mod.UNSAFE_DataRouterStateContext;
export const UNSAFE_LocationContext = mod.UNSAFE_LocationContext;
export const UNSAFE_NavigationContext = mod.UNSAFE_NavigationContext;
export const UNSAFE_RouteContext = mod.UNSAFE_RouteContext;
export const createBrowserRouter = mod.createBrowserRouter;
export const createHashRouter = mod.createHashRouter;
export const createMemoryRouter = mod.createMemoryRouter;
export const createPath = mod.createPath;
export const createRoutesFromChildren = mod.createRoutesFromChildren;
export const createRoutesFromElements = mod.createRoutesFromElements;
export const createSearchParams = mod.createSearchParams;
export const generatePath = mod.generatePath;
export const isRouteErrorResponse = mod.isRouteErrorResponse;
export const matchPath = mod.matchPath;
export const matchRoutes = mod.matchRoutes;
export const parsePath = mod.parsePath;
export const redirect = mod.redirect;
export const renderMatches = mod.renderMatches;
export const resolvePath = mod.resolvePath;
export const unstable_useBlocker = mod.unstable_useBlocker;
export const useActionData = mod.useActionData;
export const useFetcher = mod.useFetcher;
export const useFetchers = mod.useFetchers;
export const useFormAction = mod.useFormAction;
export const useHref = mod.useHref;
export const useInRouterContext = mod.useInRouterContext;
export const useLinkClickHandler = mod.useLinkClickHandler;
export const useLoaderData = mod.useLoaderData;
export const useLocation = mod.useLocation;
export const useMatch = mod.useMatch;
export const useMatches = mod.useMatches;
export const useNavigate = mod.useNavigate;
export const useNavigation = mod.useNavigation;
export const useNavigationType = mod.useNavigationType;
export const useOutlet = mod.useOutlet;
export const useOutletContext = mod.useOutletContext;
export const useParams = mod.useParams;
export const useResolvedPath = mod.useResolvedPath;
export const useRevalidator = mod.useRevalidator;
export const useRouteError = mod.useRouteError;
export const useRouteLoaderData = mod.useRouteLoaderData;
export const useRoutes = mod.useRoutes;
export const useSearchParams = mod.useSearchParams;
export const useSubmit = mod.useSubmit;

export default mod.default !== undefined ? mod.default : mod;
