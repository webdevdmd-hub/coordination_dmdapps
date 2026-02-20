import type { NavIconName } from '@/components/icons/NavIcons';
import type { PermissionKey } from '@/core/entities/permissions';

export type NavItem = {
  label: string;
  href: string;
  permissions?: PermissionKey[];
  icon: NavIconName;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const navigation: NavSection[] = [
  {
    title: 'Main',
    items: [
      {
        label: 'Main Dashboard',
        href: '/app',
        permissions: ['dashboard'],
        icon: 'dashboard',
      },
    ],
  },
  {
    title: 'Admin',
    items: [
      {
        label: 'User Management',
        href: '/app/admin/users',
        permissions: ['admin'],
        icon: 'users',
      },
      {
        label: 'Role Management',
        href: '/app/admin/roles',
        permissions: ['admin'],
        icon: 'roles',
      },
    ],
  },
  {
    title: 'Tasks',
    items: [{ label: 'Tasks', href: '/app/tasks', permissions: ['tasks'], icon: 'tasks' }],
  },
  {
    title: 'CRM',
    items: [
      { label: 'Leads', href: '/app/crm/leads', permissions: ['lead_view'], icon: 'leads' },
      {
        label: 'Calendar',
        href: '/app/crm/calendar',
        permissions: ['calendar_view'],
        icon: 'calendar',
      },
      {
        label: 'Reports',
        href: '/app/crm/reports',
        permissions: ['reports_view'],
        icon: 'reports',
      },
    ],
  },
  {
    title: 'Sales',
    items: [
      {
        label: 'Sales Dashboard',
        href: '/app/sales',
        permissions: ['sales'],
        icon: 'sales',
      },
      {
        label: 'Customers',
        href: '/app/sales/customers',
        permissions: ['customer_view'],
        icon: 'customers',
      },
      {
        label: 'Projects',
        href: '/app/sales/projects',
        permissions: ['project_view'],
        icon: 'projects',
      },
      {
        label: 'Quotation Requests',
        href: '/app/sales/quotation-requests',
        permissions: ['quotation_request_view'],
        icon: 'quotationRequests',
      },
      {
        label: 'Quotations',
        href: '/app/sales/quotations',
        permissions: ['quotation_view'],
        icon: 'quotations',
      },
      {
        label: 'Invoices',
        href: '/app/sales/invoices',
        permissions: ['invoices_view'],
        icon: 'invoices',
      },
    ],
  },
  {
    title: 'Accounts',
    items: [
      {
        label: 'Sales Order',
        href: '/app/sales-order',
        permissions: ['sales_order'],
        icon: 'salesOrder',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Store', href: '/app/store', permissions: ['store'], icon: 'store' },
      {
        label: 'Procurement',
        href: '/app/procurement',
        permissions: ['procurement'],
        icon: 'procurement',
      },
      {
        label: 'Logistics',
        href: '/app/logistics',
        permissions: ['logistics'],
        icon: 'logistics',
      },
      {
        label: 'Marketing',
        href: '/app/marketing',
        permissions: ['marketing'],
        icon: 'marketing',
      },
      { label: 'Fleet', href: '/app/fleet', permissions: ['fleet'], icon: 'fleet' },
      {
        label: 'Compliance',
        href: '/app/compliance',
        permissions: ['compliance'],
        icon: 'compliance',
      },
      { label: 'Settings', href: '/app/settings', permissions: ['settings'], icon: 'settings' },
    ],
  },
];
