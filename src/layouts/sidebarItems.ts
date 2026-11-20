const sidebarItems = [
  {
    section: 'OVERVIEW',
    items: [
      {
        nav: 'overview',
        label: 'Dashboard',
        icon: 'mdi mdi-view-dashboard-outline',
        to: '/admin/dashboard',
      },
      {
        nav: 'overview',
        label: 'Inventory',
        icon: 'mdi mdi-cube-scan',
        to: '/admin/inventory',
      },
      {
        nav: 'overview',
        label: 'Orders',
        icon: 'mdi mdi-cart-check',
        to: '/admin/orders',
      },
      {
        nav: 'overview',
        label: 'Custom Requests',
       icon: 'mdi mdi-clipboard-edit-outline',
        to: '/custom-requests',
      },
    ],
  },
]

export default sidebarItems