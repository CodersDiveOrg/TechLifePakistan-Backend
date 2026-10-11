import type { StrapiApp } from '@strapi/strapi/admin';
import { BulletList, ChartPie, Lightning, ShoppingCart, Archive } from '@strapi/icons';
import logo from './extensions/logo.svg';
import { OrderPrintPanel, PrintOrdersBulkAction } from './order-print';

// Brand colours mirror the storefront tokens (src/app/globals.css in the Next.js app).
// Strapi uses primary100/200 as hover/selected *backgrounds* and primary500–700 for text/accents,
// so light and dark mode need opposite ends of the scale.
const lightPrimary = {
  primary100: '#eef2fe',
  primary200: '#d4defd',
  primary500: '#5b7ff0',
  primary600: '#2f5bea',
  primary700: '#2448c4',
  buttonPrimary500: '#5b7ff0',
  buttonPrimary600: '#2f5bea',
};

const darkPrimary = {
  primary100: '#1a2240', // hover / selected background
  primary200: '#2b3a6e', // borders of selected items
  primary500: '#7c96f5',
  primary600: '#6d8bf3', // links, active text
  primary700: '#a3b6f9', // text on primary100 backgrounds
  buttonPrimary500: '#7c96f5',
  buttonPrimary600: '#5b7ff0',
};

export default {
  config: {
    locales: [],
    auth: { logo },
    menu: { logo },
    head: { favicon: logo },
    theme: {
      light: { colors: lightPrimary },
      dark: { colors: darkPrimary },
    },
    translations: {
      en: {
        'Auth.form.welcome.title': 'Tech Life Pakistan Admin',
        'Auth.form.welcome.subtitle': 'Sign in to manage products, orders and content',
        'app.components.LeftMenu.navbrand.title': 'Tech Life Pakistan',
        'app.components.LeftMenu.navbrand.workplace': 'Store dashboard',
        'app.components.HomePage.welcomeBlock.content.again': 'Here’s what’s happening in your store today.',
      },
    },
    tutorials: false,
    notifications: { releases: false },
  },

  register(app: StrapiApp) {
    // Full order management screen (list, filters, bulk status, detail with payments/refunds/shipping/timeline).
    app.addMenuLink({
      to: 'orders-manager',
      icon: Archive,
      intlLabel: { id: 'techlifepakistan.menu.orders', defaultMessage: 'Orders' },
      permissions: [{ action: 'plugin::content-manager.explorer.read', subject: 'api::order.order' }],
      position: 2,
      Component: () => import('./pages/orders'),
    });

    app.widgets.register([
      {
        id: 'store-overview',
        icon: ChartPie,
        title: { id: 'techlifepakistan.widget.overview', defaultMessage: 'Store overview' },
        component: async () => (await import('./widgets/OverviewWidget')).default,
      },
      {
        id: 'recent-orders',
        icon: ShoppingCart,
        title: { id: 'techlifepakistan.widget.orders', defaultMessage: 'Recent orders' },
        link: {
          label: { id: 'techlifepakistan.widget.orders.link', defaultMessage: 'All orders' },
          href: '/orders-manager',
        },
        component: async () => (await import('./widgets/RecentOrdersWidget')).default,
      },
      {
        id: 'low-stock',
        icon: BulletList,
        title: { id: 'techlifepakistan.widget.stock', defaultMessage: 'Low stock' },
        link: {
          label: { id: 'techlifepakistan.widget.stock.link', defaultMessage: 'All products' },
          href: '/content-manager/collection-types/api::product.product',
        },
        component: async () => (await import('./widgets/LowStockWidget')).default,
      },
      {
        id: 'quick-actions',
        icon: Lightning,
        title: { id: 'techlifepakistan.widget.actions', defaultMessage: 'Quick actions' },
        component: async () => (await import('./widgets/QuickActionsWidget')).default,
      },
    ]);
  },

  bootstrap(app: StrapiApp) {
    // Print / dispatch documents straight from the Content Manager order screens.
    const cm = app.getPlugin('content-manager') as unknown as {
      apis: {
        addEditViewSidePanel: (panels: unknown[]) => void;
        addBulkAction: (actions: unknown[]) => void;
      };
    };
    cm.apis.addEditViewSidePanel([OrderPrintPanel]);
    cm.apis.addBulkAction([PrintOrdersBulkAction]);
  },
};
