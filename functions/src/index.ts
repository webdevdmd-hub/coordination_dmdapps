/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from 'firebase-functions';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

initializeApp();

export const onNotificationEventCreate = onDocumentCreated(
  'notificationEvents/{eventId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      return;
    }
    const db = getFirestore();
    const now = new Date().toISOString();
    const broadcast = Boolean(data.broadcast);
    let recipients: string[] = Array.isArray(data.recipients)
      ? data.recipients.filter((value: unknown) => typeof value === 'string')
      : [];

    if (broadcast) {
      const usersSnap = await db.collection('users').where('active', '==', true).get();
      recipients = usersSnap.docs.map((docSnap) => docSnap.id);
    }

    const uniqueRecipients = Array.from(new Set(recipients));
    if (uniqueRecipients.length === 0) {
      return;
    }

    const batch = db.batch();
    uniqueRecipients.forEach((userId) => {
      const ref = db.collection('notifications').doc();
      batch.set(ref, {
        userId,
        type: data.type ?? 'generic',
        title: data.title ?? 'Notification',
        body: data.body ?? '',
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        createdAt: data.createdAt ?? now,
        readAt: null,
        meta: data.meta ?? {},
        actorId: data.actorId ?? null,
      });
    });
    await batch.commit();
  },
);

export const onNotificationCreate = onDocumentCreated(
  'notifications/{notificationId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      return;
    }
    const userId = data.userId;
    if (!userId) {
      return;
    }
    const db = getFirestore();
    const tokensSnap = await db.collection('userDevices').doc(userId).collection('tokens').get();
    if (tokensSnap.empty) {
      return;
    }
    const tokens = tokensSnap.docs.map((docSnap) => docSnap.id);
    if (tokens.length === 0) {
      return;
    }

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: data.title ?? 'Notification',
        body: data.body ?? '',
      },
      data: {
        notificationId: event.data?.id ?? '',
        type: String(data.type ?? ''),
        entityType: String(data.entityType ?? ''),
        entityId: String(data.entityId ?? ''),
      },
    });

    const invalidTokens: string[] = [];
    response.responses.forEach((res, index) => {
      if (!res.success) {
        const code = res.error?.code ?? '';
        if (
          code.includes('messaging/registration-token-not-registered') ||
          code.includes('messaging/invalid-registration-token')
        ) {
          invalidTokens.push(tokens[index]);
        } else {
          logger.warn('Push send failed', { code, message: res.error?.message });
        }
      }
    });

    await Promise.all(
      invalidTokens.map((token) =>
        db.collection('userDevices').doc(userId).collection('tokens').doc(token).delete(),
      ),
    );
  },
);

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
