import type { NotificationEntityType, NotificationType } from '@/core/entities/notification';
import type { PermissionKey } from '@/core/entities/permissions';

export const MODULE_NOTIFICATION_PERMISSION_MAP = {
  tasks: [
    'admin',
    'tasks',
    'task_create',
    'task_view',
    'task_view_all',
    'task_view_same_role',
    'task_edit',
    'task_delete',
    'task_assign',
  ],
  projects: [
    'admin',
    'project_create',
    'project_view',
    'project_view_all',
    'project_view_same_role',
    'project_edit',
    'project_delete',
    'project_assign',
  ],
  quotationRequests: [
    'admin',
    'quotation_request_create',
    'quotation_request_view',
    'quotation_request_view_all',
    'quotation_request_view_same_role',
    'quotation_request_edit',
    'quotation_request_delete',
    'quotation_request_assign',
  ],
  salesOrder: [
    'admin',
    'sales_order',
    'sales_order_request_create',
    'sales_order_request_view',
    'sales_order_request_approve',
  ],
} as const satisfies Record<string, PermissionKey[]>;

export type NotificationAudienceModuleKey = keyof typeof MODULE_NOTIFICATION_PERMISSION_MAP;

type NotificationEventArgs = {
  type: NotificationType;
  title: string;
  body: string;
  actorId: string;
  recipients?: string[];
  broadcast?: boolean;
  entityType?: NotificationEntityType;
  entityId?: string;
  meta?: Record<string, unknown>;
  requiredPermissionsAnyOf?: PermissionKey[];
};

export const getModuleNotificationPermissions = (moduleKey: NotificationAudienceModuleKey) =>
  MODULE_NOTIFICATION_PERMISSION_MAP[moduleKey];

export const buildRecipientList = (
  primary?: string,
  others?: Array<string | undefined | null>,
  actorId?: string,
) => {
  const recipients = new Set<string>();
  if (primary) {
    recipients.add(primary);
  }
  (others ?? []).forEach((value) => {
    if (value) {
      recipients.add(value);
    }
  });
  if (actorId) {
    recipients.delete(actorId);
  }
  return Array.from(recipients.values());
};

export const areSameRecipientSets = (left: string[] = [], right: string[] = []) => {
  if (left.length !== right.length) {
    return false;
  }
  const leftSet = new Set(left);
  if (leftSet.size !== right.length) {
    return false;
  }
  return right.every((value) => leftSet.has(value));
};

export const emitNotificationEvent = async (input: NotificationEventArgs) => {
  if (input.broadcast !== true && (!input.recipients || input.recipients.length === 0)) {
    return;
  }
  const response = await fetch('/api/notifications/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      recipients: input.recipients ?? [],
      broadcast: input.broadcast ?? false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Notification event request failed (${response.status}).`);
  }
};

export const emitNotificationEventSafe = async (input: NotificationEventArgs) => {
  try {
    await emitNotificationEvent(input);
  } catch {
    // Notification failures should not block main workflows.
  }
};
