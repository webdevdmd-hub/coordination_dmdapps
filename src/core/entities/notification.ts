export type NotificationType =
  | 'task.assigned'
  | 'task.status_changed'
  | 'task.timer_started'
  | 'task.timer_stopped'
  | 'calendar.broadcast'
  | (string & {});

export type NotificationEntityType =
  | 'task'
  | 'project'
  | 'lead'
  | 'quotationRequest'
  | 'calendar'
  | (string & {});

export type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  createdAt: string;
  readAt?: string;
  meta?: Record<string, unknown>;
};

export type NotificationEvent = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  actorId: string;
  recipients?: string[];
  broadcast?: boolean;
  createdAt: string;
  meta?: Record<string, unknown>;
};
