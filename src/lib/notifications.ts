import { firebaseNotificationEventRepository } from '@/adapters/repositories/firebaseNotificationEventRepository';
import type { NotificationEntityType, NotificationType } from '@/core/entities/notification';

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
};

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
  await firebaseNotificationEventRepository.create({
    type: input.type,
    title: input.title,
    body: input.body,
    actorId: input.actorId,
    recipients: input.recipients ?? [],
    broadcast: input.broadcast ?? false,
    entityType: input.entityType,
    entityId: input.entityId,
    meta: input.meta,
  });
};

export const emitNotificationEventSafe = async (input: NotificationEventArgs) => {
  try {
    await emitNotificationEvent(input);
  } catch {
    // Notification failures should not block main workflows.
  }
};
