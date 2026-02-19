export type PermissionKey =
  | 'admin'
  | 'lead_create'
  | 'lead_view'
  | 'lead_view_all'
  | 'lead_edit'
  | 'lead_delete'
  | 'lead_source_manage'
  | 'profile_view_self'
  | 'profile_edit_name'
  | 'profile_edit_email'
  | 'profile_edit_phone'
  | 'profile_edit_avatar'
  | 'profile_edit_role'
  | 'profile_password_reset'
  | 'calendar_create'
  | 'calendar_view'
  | 'calendar_view_all'
  | 'calendar_edit'
  | 'calendar_delete'
  | 'reports_view'
  | 'dashboard'
  | 'crm'
  | 'tasks'
  | 'task_create'
  | 'task_view'
  | 'task_view_all'
  | 'task_edit'
  | 'task_delete'
  | 'task_assign'
  | 'customer_create'
  | 'customer_view'
  | 'customer_view_all'
  | 'customer_edit'
  | 'customer_delete'
  | 'customer_assign'
  | 'project_create'
  | 'project_view'
  | 'project_view_all'
  | 'project_edit'
  | 'project_delete'
  | 'project_assign'
  | 'quotation_create'
  | 'quotation_view'
  | 'quotation_view_all'
  | 'quotation_edit'
  | 'quotation_delete'
  | 'quotation_assign'
  | 'quotation_request_create'
  | 'quotation_request_view'
  | 'quotation_request_view_all'
  | 'quotation_request_edit'
  | 'quotation_request_delete'
  | 'quotation_request_assign'
  | 'sales_order_request_create'
  | 'sales_order_request_view'
  | 'sales_order_request_approve'
  | 'po_request_create'
  | 'po_request_view'
  | 'po_request_approve'
  | 'calendar_assign'
  | 'invoices_view'
  | 'sales'
  | 'operations'
  | 'sales_order'
  | 'store'
  | 'procurement'
  | 'logistics'
  | 'marketing'
  | 'fleet'
  | 'compliance'
  | 'settings';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'admin',
  'lead_create',
  'lead_view',
  'lead_view_all',
  'lead_edit',
  'lead_delete',
  'lead_source_manage',
  'profile_view_self',
  'profile_edit_name',
  'profile_edit_email',
  'profile_edit_phone',
  'profile_edit_avatar',
  'profile_edit_role',
  'profile_password_reset',
  'calendar_create',
  'calendar_view',
  'calendar_view_all',
  'calendar_edit',
  'calendar_delete',
  'reports_view',
  'dashboard',
  'crm',
  'tasks',
  'task_create',
  'task_view',
  'task_view_all',
  'task_edit',
  'task_delete',
  'task_assign',
  'customer_create',
  'customer_view',
  'customer_view_all',
  'customer_edit',
  'customer_delete',
  'customer_assign',
  'project_create',
  'project_view',
  'project_view_all',
  'project_edit',
  'project_delete',
  'project_assign',
  'quotation_create',
  'quotation_view',
  'quotation_view_all',
  'quotation_edit',
  'quotation_delete',
  'quotation_assign',
  'quotation_request_create',
  'quotation_request_view',
  'quotation_request_view_all',
  'quotation_request_edit',
  'quotation_request_delete',
  'quotation_request_assign',
  'sales_order_request_create',
  'sales_order_request_view',
  'sales_order_request_approve',
  'po_request_create',
  'po_request_view',
  'po_request_approve',
  'calendar_assign',
  'invoices_view',
  'sales',
  'operations',
  'sales_order',
  'store',
  'procurement',
  'logistics',
  'marketing',
  'fleet',
  'compliance',
  'settings',
];
