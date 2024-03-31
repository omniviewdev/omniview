import BottomDrawer from './BottomDrawer';
import Main from './Main';
import Root from './Root';
import SideDrawer from './SideDrawer';
import SideNav from './SideNav';
import SidePane from './SidePane';

/**
 * This layout provides a left sidenav layout for the application.
 *
 * @returns A layout component
 * @example
 * import Layout from '@/layouts/core/sidenav'
 *
 * const MyPage = () => {
 *  return (
 *    <Layout.Root>
 *
 *      <Layout.SideNav>
 *        <MySideNavContent />
 *      </Layout.SideNav>
 *
 *      <Layout.Main>
 *        <MyMainContent />
 *      </Layout.Main>
 *    </Layout.Root>
 *  )
 */
export default {
  Main,
  Root,
  SideDrawer,
  SideNav,
  SidePane,
  BottomDrawer,
};
