const sidebarItems = [
  {
    section: 'OVERVIEW',
    items: [
      {
        nav: 'overview',
        label: 'Dashboard',
        icon: 'mdi mdi-view-dashboard-outline',
        to: '/admin/dashboard',
        roles: [
          'owner',
          'admin',
          'catalog_manager',
          'order_manager',
          'support'
        ]
      },
      {
        nav: 'overview',
        label: 'Inventory',
        icon: 'mdi mdi-cube-scan',
        to: '/admin/inventory',
        roles: [
          'owner',
          'admin',
          'catalog_manager'
        ]
      },
      {
        nav: 'overview',
        label: 'Orders',
        icon: 'mdi mdi-cart-check',
        to: '/admin/orders',
        roles: [
          'owner',
          'admin',
          'order_manager'
        ]
      },
      {
        nav: 'overview',
        label: 'Custom Requests',
        icon: 'mdi mdi-clipboard-edit-outline',
        to: '/custom-requests',
        roles: [
          'owner',
          'admin',
          'order_manager',
          'support'
        ]
      },
      {
        nav: 'overview',
        label: 'Messages',
        icon: 'mdi mdi-message-text-outline',
        to: '/messages',
        roles: [
          'owner',
          'admin',
          'support'
        ]
      }
    ]
  },
  {
    section: 'ADMINISTRATION',
    items: [
      {
        nav: 'administration',
        label: 'User Management',
        icon: 'mdi mdi-account-group-outline',
        to: '/admin/users',
        roles: [
          'owner',
          'admin'
        ]
      }
    ]
  }
]

export default sidebarItems