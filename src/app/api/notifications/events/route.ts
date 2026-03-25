import { NextResponse } from 'next/server';

import type { NotificationEntityType, NotificationType } from '@/core/entities/notification';
import type { PermissionKey } from '@/core/entities/permissions';
import { getAuthedUserFromSession } from '@/lib/auth/serverSession';
import { dispatchNotificationEvent } from '@/server/notifications/eventService';

export const runtime = 'nodejs';

type NotificationEventPayload = {
  type?: NotificationType;
  title?: string;
  body?: string;
  actorId?: string;
  recipients?: string[];
  broadcast?: boolean;
  entityType?: NotificationEntityType;
  entityId?: string;
  meta?: Record<string, unknown>;
  requiredPermissionsAnyOf?: PermissionKey[];
};

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
  let payload: NotificationEventPayload;
  try {
    payload = (await request.json()) as NotificationEventPayload;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  const authedUser = await getAuthedUserFromSession(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }

  const type = String(payload.type ?? '').trim();
  const title = String(payload.title ?? '').trim();
  const body = String(payload.body ?? '').trim();
  const actorId = String(payload.actorId ?? authedUser.id).trim();
  const recipients = Array.isArray(payload.recipients)
    ? payload.recipients.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const broadcast = payload.broadcast === true;
  const requiredPermissionsAnyOf = Array.isArray(payload.requiredPermissionsAnyOf)
    ? payload.requiredPermissionsAnyOf.filter(
        (value): value is PermissionKey => typeof value === 'string' && value.trim().length > 0,
      )
    : [];

  if (!type || !title) {
    return toErrorResponse('Type and title are required.');
  }
  if (!broadcast && recipients.length === 0) {
    return toErrorResponse('Recipients are required when broadcast is false.');
  }
  if (actorId !== authedUser.id) {
    return toErrorResponse('Actor mismatch.', 403);
  }

  const created = await dispatchNotificationEvent({
    type,
    title,
    body,
    actorId: authedUser.id,
    recipients,
    broadcast,
    entityType: payload.entityType,
    entityId: payload.entityId,
    meta: payload.meta,
    requiredPermissionsAnyOf,
  });

  return NextResponse.json({ ok: true, eventId: created?.id ?? null });
}
