import { useState, useEffect } from 'react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  Link,
  Outlet,
} from '@tanstack/react-router';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Divider from '@mui/material/Divider';
import { LuSun, LuMoon, LuContrast, LuChevronDown, LuChevronRight } from 'react-icons/lu';

import ThemePage from './pages/ThemePage';
import IconPage from './pages/IconPage';
import CardPage from './pages/CardPage';
import ExpandableSectionsPage from './pages/ExpandableSectionsPage';
import InputsPage from './pages/InputsPage';
import CellsPage from './pages/CellsPage';
import TablePage from './pages/TablePage';
import UtilsPage from './pages/UtilsPage';
import ButtonPage from './pages/ButtonPage';
import FeedbackPage from './pages/FeedbackPage';
import TypographyPage from './pages/TypographyPage';
import TextFieldPage from './pages/TextFieldPage';
import SelectPage from './pages/SelectPage';
import FormPage from './pages/FormPage';
import TagInputPage from './pages/TagInputPage';
import DialogPage from './pages/DialogPage';
import DrawerPage from './pages/DrawerPage';
import TooltipPage from './pages/TooltipPage';
import PopoverPage from './pages/PopoverPage';
import ToastPage from './pages/ToastPage';
import TabsPage from './pages/TabsPage';
import TreeViewPage from './pages/TreeViewPage';
import BreadcrumbsPage from './pages/BreadcrumbsPage';
import DataTablePage from './pages/DataTablePage';
import CodeEditorPage from './pages/CodeEditorPage';
import CommandPalettePage from './pages/CommandPalettePage';
import UtilityComponentsPage from './pages/UtilityComponentsPage';
import BadgePage from './pages/BadgePage';
import AvatarPage from './pages/AvatarPage';
import PickersPage from './pages/PickersPage';
import ResizableSplitPanePage from './pages/ResizableSplitPanePage';
import AppShellPage from './pages/AppShellPage';
import PanelPage from './pages/PanelPage';
import LayoutPrimitivesPage from './pages/LayoutPrimitivesPage';
import ResourceRefPage from './pages/ResourceRefPage';
import ObjectInspectorPage from './pages/ObjectInspectorPage';
import LogsViewerPage from './pages/LogsViewerPage';
import EventsListPage from './pages/EventsListPage';
import MetricCardPage from './pages/MetricCardPage';

// Phase 9: Menus
import ContextMenuPage from './pages/ContextMenuPage';
import MenuBarPage from './pages/MenuBarPage';

// Phase 11: Toolbars & Status
import ToolbarPage from './pages/ToolbarPage';
import StatusBarPage from './pages/StatusBarPage';

// Phase 12: Advanced IDE
import NotificationCenterPage from './pages/NotificationCenterPage';
import SpotlightPage from './pages/SpotlightPage';
import DraggableTabsPage from './pages/DraggableTabsPage';
import DockLayoutPage from './pages/DockLayoutPage';
import TimelinePage from './pages/TimelinePage';
import FilterBarPage from './pages/FilterBarPage';
import MiscIDEPage from './pages/MiscIDEPage';

// Phase 10: Sidebars
import ActivityBarPage from './pages/ActivityBarPage';
import SidebarGroupPage from './pages/SidebarGroupPage';
import PropertyGridPage from './pages/PropertyGridPage';
import NavMenuPage from './pages/NavMenuPage';

// New: IDE Table, Notifications, Status Footer, Progress
import IDETablePage from './pages/IDETablePage';
import NotificationStackPage from './pages/NotificationStackPage';
import IDEStatusFooterPage from './pages/IDEStatusFooterPage';
import ProgressPage from './pages/ProgressPage';

// Phase 13: Charts
import ChartsPage from './pages/ChartsPage';
import MetricsPanelPage from './pages/MetricsPanelPage';

// --- Navigation structure ---

interface NavItem {
  label: string;
  path: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Foundations',
    items: [
      { label: 'Theme & Tokens', path: '/theme' },
      { label: 'Icons', path: '/icons' },
      { label: 'Typography', path: '/typography' },
    ],
  },
  {
    title: 'Buttons',
    items: [
      { label: 'Button', path: '/buttons' },
      { label: 'Toolbar & Toggle', path: '/toolbar' },
    ],
  },
  {
    title: 'Menus',
    items: [
      { label: 'Context & Dropdown Menu', path: '/context-menu' },
      { label: 'MenuBar & SplitButton', path: '/menu-bar' },
    ],
  },
  {
    title: 'Sidebars',
    items: [
      { label: 'ActivityBar & SidebarPanel', path: '/activity-bar' },
      { label: 'SidebarGroup & TreeItem', path: '/sidebar-group' },
      { label: 'PropertyGrid', path: '/property-grid' },
      { label: 'NavMenu', path: '/nav-menu' },
    ],
  },
  {
    title: 'Inputs',
    items: [
      { label: 'TextField & TextArea', path: '/textfield' },
      { label: 'Select & Autocomplete', path: '/select' },
      { label: 'Checkbox, Radio & Switch', path: '/form-controls' },
      { label: 'TagInput & KeyValueEditor', path: '/tag-input' },
      { label: 'DebouncedInput & Search', path: '/inputs' },
      { label: 'Pickers', path: '/pickers' },
    ],
  },
  {
    title: 'Feedback',
    items: [
      { label: 'Alert & Status', path: '/feedback' },
      { label: 'StatusBar & Progress', path: '/status-bar' },
      { label: 'Progress Indicators', path: '/progress' },
      { label: 'IDE Status Footer', path: '/ide-status-footer' },
      { label: 'Notification Stack', path: '/notification-stack' },
    ],
  },
  {
    title: 'Overlays',
    items: [
      { label: 'Dialog', path: '/dialog' },
      { label: 'Drawer', path: '/drawer' },
      { label: 'Tooltip', path: '/tooltip' },
      { label: 'Popover', path: '/popover' },
      { label: 'Toast', path: '/toast' },
      { label: 'Notifications', path: '/notifications' },
      { label: 'Spotlight Search', path: '/spotlight' },
    ],
  },
  {
    title: 'Components',
    items: [
      { label: 'Cards', path: '/cards' },
      { label: 'Expandable Sections', path: '/expandable-sections' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { label: 'Tabs', path: '/tabs' },
      { label: 'DraggableTabs', path: '/draggable-tabs' },
      { label: 'TreeView', path: '/treeview' },
      { label: 'Breadcrumbs & Stepper', path: '/breadcrumbs' },
    ],
  },
  {
    title: 'Data Display',
    items: [
      { label: 'IDETable', path: '/ide-table' },
      { label: 'DataTable', path: '/datatable' },
      { label: 'Table Cells', path: '/cells' },
      { label: 'Table', path: '/table' },
      { label: 'Badge', path: '/badge' },
      { label: 'Avatar', path: '/avatar' },
    ],
  },
  {
    title: 'Editors',
    items: [
      { label: 'CodeEditor & DiffViewer', path: '/code-editor' },
      { label: 'CommandPalette', path: '/command-palette' },
    ],
  },
  {
    title: 'Domain (Kubernetes)',
    items: [
      { label: 'ResourceRef & ResourceStatus', path: '/resource-ref' },
      { label: 'ObjectInspector', path: '/object-inspector' },
      { label: 'EventsList & LogsViewer', path: '/events-logs' },
      { label: 'MetricCard & SecretValueMask', path: '/metric-card' },
      { label: 'Timeline', path: '/timeline' },
      { label: 'FilterBar', path: '/filter-bar' },
    ],
  },
  {
    title: 'Layout',
    items: [
      { label: 'ResizableSplitPane', path: '/resizable-split-pane' },
      { label: 'DockLayout', path: '/dock-layout' },
      { label: 'AppShell', path: '/app-shell' },
      { label: 'Panel', path: '/panel' },
      { label: 'Stack & Inline', path: '/layout-primitives' },
    ],
  },
  {
    title: 'Utilities',
    items: [
      { label: 'ClipboardText & OverflowText', path: '/utility-components' },
      { label: 'InlineEdit & HotkeyHint', path: '/utility-components' },
      { label: 'Formatters', path: '/utils' },
    ],
  },
  {
    title: 'Advanced IDE',
    items: [
      { label: 'Misc IDE Components', path: '/misc-ide' },
    ],
  },
  {
    title: 'Charts',
    items: [
      { label: 'Core Charts', path: '/charts' },
      { label: 'Metrics & Gauges', path: '/metrics-panel' },
    ],
  },
];

// --- Theme toggle ---

function setTheme(mode: 'dark' | 'light' | 'high-contrast') {
  document.documentElement.setAttribute('data-ov-theme', mode);
  document.documentElement.removeAttribute('style');
}

// --- Collapsible section ---

const COLLAPSED_KEY = 'ov-showcase-collapsed';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
}

// --- Root layout ---

function RootLayout() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const toggle = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box
        component="nav"
        sx={{
          width: 240,
          minWidth: 240,
          height: '100%',
          bgcolor: 'var(--ov-bg-surface)',
          borderRight: '1px solid var(--ov-border-default)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <Box sx={{ p: 1.5, pb: 1 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ov-fg-muted)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              mb: 1,
            }}
          >
            @omniviewdev/ui
          </Typography>
          <ButtonGroup size="small" fullWidth>
            <Button onClick={() => setTheme('dark')} startIcon={<LuMoon size={12} />}>
              Dark
            </Button>
            <Button onClick={() => setTheme('light')} startIcon={<LuSun size={12} />}>
              Light
            </Button>
            <Button onClick={() => setTheme('high-contrast')} startIcon={<LuContrast size={12} />}>
              HC
            </Button>
          </ButtonGroup>
        </Box>

        <Divider sx={{ my: 0.5 }} />

        {/* Nav sections */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 0.5, pb: 2 }}>
          {navSections.map((section) => {
            const isCollapsed = !!collapsed[section.title];
            return (
              <Box key={section.title} sx={{ mb: 0.5 }}>
                <Box
                  onClick={() => toggle(section.title)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.25,
                    px: 1,
                    py: 0.5,
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderRadius: '4px',
                    '&:hover': { bgcolor: 'var(--ov-state-hover)' },
                  }}
                >
                  {isCollapsed ? (
                    <LuChevronRight size={12} color="var(--ov-fg-faint)" />
                  ) : (
                    <LuChevronDown size={12} color="var(--ov-fg-faint)" />
                  )}
                  <Typography
                    variant="overline"
                    sx={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--ov-fg-faint)',
                      letterSpacing: '0.08em',
                      lineHeight: 1.5,
                    }}
                  >
                    {section.title}
                  </Typography>
                </Box>
                {!isCollapsed &&
                  section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      style={{ textDecoration: 'none' }}
                    >
                      {({ isActive }) => (
                        <Box
                          sx={{
                            px: 1.5,
                            py: 0.5,
                            ml: 1.5,
                            my: 0.25,
                            borderRadius: '4px',
                            fontSize: 12,
                            fontWeight: isActive ? 500 : 400,
                            color: isActive ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
                            bgcolor: isActive ? 'var(--ov-accent-subtle)' : 'transparent',
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: isActive
                                ? 'var(--ov-accent-subtle)'
                                : 'var(--ov-state-hover)',
                            },
                          }}
                        >
                          {item.label}
                        </Box>
                      )}
                    </Link>
                  ))}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Content area */}
      <Box
        component="main"
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 4,
          bgcolor: 'var(--ov-bg-base)',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}

// --- Route definitions ---

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ThemePage,
});

const themeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/theme',
  component: ThemePage,
});

const iconsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/icons',
  component: IconPage,
});

const cardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cards',
  component: CardPage,
});

const expandableSectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expandable-sections',
  component: ExpandableSectionsPage,
});

const inputsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inputs',
  component: InputsPage,
});

const cellsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cells',
  component: CellsPage,
});

const tableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/table',
  component: TablePage,
});

const utilsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/utils',
  component: UtilsPage,
});

const buttonsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/buttons',
  component: ButtonPage,
});

const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/feedback',
  component: FeedbackPage,
});

const typographyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/typography',
  component: TypographyPage,
});

const textFieldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/textfield',
  component: TextFieldPage,
});

const selectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/select',
  component: SelectPage,
});

const formControlsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/form-controls',
  component: FormPage,
});

const tagInputRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tag-input',
  component: TagInputPage,
});

const dialogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dialog',
  component: DialogPage,
});

const drawerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drawer',
  component: DrawerPage,
});

const tooltipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tooltip',
  component: TooltipPage,
});

const popoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/popover',
  component: PopoverPage,
});

const toastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/toast',
  component: ToastPage,
});

const codeEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/code-editor',
  component: CodeEditorPage,
});

const commandPaletteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/command-palette',
  component: CommandPalettePage,
});

const tabsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tabs',
  component: TabsPage,
});

const treeViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/treeview',
  component: TreeViewPage,
});

const breadcrumbsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/breadcrumbs',
  component: BreadcrumbsPage,
});

const dataTableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/datatable',
  component: DataTablePage,
});

const resizableSplitPaneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resizable-split-pane',
  component: ResizableSplitPanePage,
});

const appShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app-shell',
  component: AppShellPage,
});

const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/panel',
  component: PanelPage,
});

const layoutPrimitivesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/layout-primitives',
  component: LayoutPrimitivesPage,
});

const resourceRefRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/resource-ref',
  component: ResourceRefPage,
});

const objectInspectorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/object-inspector',
  component: ObjectInspectorPage,
});

const eventsLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/events-logs',
  component: EventsListPage,
});

const metricCardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/metric-card',
  component: MetricCardPage,
});

const logsViewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs-viewer',
  component: LogsViewerPage,
});

const utilityComponentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/utility-components',
  component: UtilityComponentsPage,
});

const badgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/badge',
  component: BadgePage,
});

const avatarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/avatar',
  component: AvatarPage,
});

const pickersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pickers',
  component: PickersPage,
});

// Phase 9: Menus
const contextMenuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/context-menu',
  component: ContextMenuPage,
});

const menuBarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/menu-bar',
  component: MenuBarPage,
});

// Phase 10: Sidebars
const activityBarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity-bar',
  component: ActivityBarPage,
});

const sidebarGroupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sidebar-group',
  component: SidebarGroupPage,
});

const propertyGridRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/property-grid',
  component: PropertyGridPage,
});

const navMenuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nav-menu',
  component: NavMenuPage,
});

// Phase 11: Toolbars & Status
const toolbarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/toolbar',
  component: ToolbarPage,
});

const statusBarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/status-bar',
  component: StatusBarPage,
});

// Phase 12: Advanced IDE
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: NotificationCenterPage,
});

const spotlightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/spotlight',
  component: SpotlightPage,
});

const draggableTabsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/draggable-tabs',
  component: DraggableTabsPage,
});

const dockLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dock-layout',
  component: DockLayoutPage,
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timeline',
  component: TimelinePage,
});

const filterBarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/filter-bar',
  component: FilterBarPage,
});

const miscIDERoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/misc-ide',
  component: MiscIDEPage,
});

// New routes
const ideTableRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ide-table',
  component: IDETablePage,
});

const notificationStackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notification-stack',
  component: NotificationStackPage,
});

const ideStatusFooterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ide-status-footer',
  component: IDEStatusFooterPage,
});

const progressRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/progress',
  component: ProgressPage,
});

// Phase 13: Charts
const chartsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charts',
  component: ChartsPage,
});

const metricsPanelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/metrics-panel',
  component: MetricsPanelPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  themeRoute,
  iconsRoute,
  cardsRoute,
  expandableSectionsRoute,
  inputsRoute,
  cellsRoute,
  tableRoute,
  utilsRoute,
  buttonsRoute,
  feedbackRoute,
  typographyRoute,
  textFieldRoute,
  selectRoute,
  formControlsRoute,
  tagInputRoute,
  dialogRoute,
  drawerRoute,
  tooltipRoute,
  popoverRoute,
  toastRoute,
  tabsRoute,
  treeViewRoute,
  breadcrumbsRoute,
  dataTableRoute,
  codeEditorRoute,
  commandPaletteRoute,
  resourceRefRoute,
  objectInspectorRoute,
  eventsLogsRoute,
  metricCardRoute,
  logsViewerRoute,
  resizableSplitPaneRoute,
  appShellRoute,
  panelRoute,
  layoutPrimitivesRoute,
  utilityComponentsRoute,
  badgeRoute,
  avatarRoute,
  pickersRoute,
  // Phase 9
  contextMenuRoute,
  menuBarRoute,
  // Phase 10
  activityBarRoute,
  sidebarGroupRoute,
  propertyGridRoute,
  navMenuRoute,
  // Phase 11
  toolbarRoute,
  statusBarRoute,
  // Phase 12
  notificationsRoute,
  spotlightRoute,
  draggableTabsRoute,
  dockLayoutRoute,
  timelineRoute,
  filterBarRoute,
  miscIDERoute,
  // New
  ideTableRoute,
  notificationStackRoute,
  ideStatusFooterRoute,
  progressRoute,
  // Phase 13
  chartsRoute,
  metricsPanelRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
