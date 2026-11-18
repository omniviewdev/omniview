// The public surface of the page package: the list page and the detail page, and the types a screen states them with. Everything else here is internal to them.
export { ListPage } from './ListPage';
export type { ListPageProps } from './ListPage';
export type { ListPageDefinition, ListQuickFilter, ListQuickFilters, ListSource, ListSourceState } from './definition';
export { DetailPage } from './DetailPage';
export type { DetailPageProps } from './DetailPage';
export type {
  DetailIdentity,
  DetailKvSection,
  DetailListSection,
  DetailPageDefinition,
  DetailPlacement,
  DetailSection,
  DetailSource,
  DetailState,
  DetailTab,
  DetailTableSection,
  DetailTabContent,
  DetailTagsSection,
  DetailView,
} from './detailDefinition';
export { facetsOf, nameOf, titleOf } from './detailIdentity';
export type { RouteParams } from './detailIdentity';
