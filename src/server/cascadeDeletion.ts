import type { DocumentReference, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from '@/frameworks/firebase/admin';
import type { AuthedUser } from '@/lib/auth/serverSession';

type ArchivedDoc = {
  path: string;
  data: Record<string, unknown>;
};

type CascadeDeleteSummary = {
  rootType: 'lead' | 'project';
  rootId: string;
  deletedCounts: Record<string, number>;
  archivedOperationId: string;
  auditLogId: string;
};

type CascadeDeleteContext = {
  db: Firestore;
  operationId: string;
  archivedDocs: ArchivedDoc[];
  deletedCounts: Record<string, number>;
  visitedPaths: Set<string>;
};

const SALES_NAMESPACE_ID = 'main';
const CRM_NAMESPACE_ID = 'main';
const SALES_ORDER_NAMESPACE_ID = 'main';
const DELETE_BATCH_SIZE = 350;

const nowIso = () => new Date().toISOString();

const incrementCount = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const collectSnapshot = async (
  context: CascadeDeleteContext,
  snapshot: QueryDocumentSnapshot,
  bucket: string,
) => {
  const path = snapshot.ref.path;
  if (context.visitedPaths.has(path)) {
    return;
  }
  context.visitedPaths.add(path);
  context.archivedDocs.push({
    path,
    data: snapshot.data() as Record<string, unknown>,
  });
  incrementCount(context.deletedCounts, bucket);
};

const collectSingleDoc = async (
  context: CascadeDeleteContext,
  ref: DocumentReference,
  bucket: string,
) => {
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return null;
  }
  await collectSnapshot(context, snapshot as QueryDocumentSnapshot, bucket);
  return snapshot as QueryDocumentSnapshot;
};

const collectQuery = async (
  context: CascadeDeleteContext,
  snapshots: QueryDocumentSnapshot[],
  bucket: string,
) => {
  await Promise.all(snapshots.map((snapshot) => collectSnapshot(context, snapshot, bucket)));
};

const collectProjectActivities = async (context: CascadeDeleteContext, projectId: string) => {
  const snapshots = await context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('projects')
    .doc(projectId)
    .collection('activities')
    .get();
  await collectQuery(context, snapshots.docs, 'projectActivities');
};

const collectQuotationRequestTasks = async (context: CascadeDeleteContext, requestId: string) => {
  const snapshots = await context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('quotation_requests')
    .doc(requestId)
    .collection('tasks')
    .get();
  await collectQuery(context, snapshots.docs, 'quotationRequestTasks');

  const linkedTaskIds = Array.from(
    new Set(
      snapshots.docs
        .map((taskDoc) => {
          const taskId = taskDoc.data().taskId;
          return typeof taskId === 'string' ? taskId.trim() : '';
        })
        .filter(Boolean),
    ),
  );

  await Promise.all(
    linkedTaskIds.map((taskId) =>
      collectSingleDoc(context, context.db.collection('tasks').doc(taskId), 'tasks'),
    ),
  );
};

const collectQuotationRequestsForLead = async (context: CascadeDeleteContext, leadId: string) => {
  const snapshots = await context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('quotation_requests')
    .where('leadId', '==', leadId)
    .get();
  await collectQuery(context, snapshots.docs, 'quotationRequests');
  await Promise.all(
    snapshots.docs.map((requestDoc) => collectQuotationRequestTasks(context, requestDoc.id)),
  );
};

const collectQuotationRequestsForCustomer = async (
  context: CascadeDeleteContext,
  customerId: string,
) => {
  const snapshots = await context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('quotation_requests')
    .where('customerId', '==', customerId)
    .get();
  await collectQuery(context, snapshots.docs, 'quotationRequests');
  await Promise.all(
    snapshots.docs.map((requestDoc) => collectQuotationRequestTasks(context, requestDoc.id)),
  );
};

const collectProjectCascade = async (context: CascadeDeleteContext, projectId: string) => {
  const projectRef = context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('projects')
    .doc(projectId);
  const projectSnap = await collectSingleDoc(context, projectRef, 'projects');
  if (!projectSnap) {
    return false;
  }

  const [taskSnapshots, quotationSnapshots, salesOrderSnapshots] = await Promise.all([
    context.db.collection('tasks').where('projectId', '==', projectId).get(),
    context.db
      .collection('sales')
      .doc(SALES_NAMESPACE_ID)
      .collection('quatations')
      .where('projectId', '==', projectId)
      .get(),
    context.db
      .collection('sales_order')
      .doc(SALES_ORDER_NAMESPACE_ID)
      .collection('sales_order_requests')
      .where('projectId', '==', projectId)
      .get(),
  ]);

  await Promise.all([
    collectQuery(context, taskSnapshots.docs, 'tasks'),
    collectQuery(context, quotationSnapshots.docs, 'quotations'),
    collectQuery(context, salesOrderSnapshots.docs, 'salesOrderRequests'),
    collectProjectActivities(context, projectId),
  ]);

  return true;
};

const collectCustomerCascade = async (context: CascadeDeleteContext, customerId: string) => {
  const customerRef = context.db
    .collection('sales')
    .doc(SALES_NAMESPACE_ID)
    .collection('customers')
    .doc(customerId);
  const customerSnap = await collectSingleDoc(context, customerRef, 'customers');
  if (!customerSnap) {
    return;
  }

  const [projectSnapshots, quotationSnapshots] = await Promise.all([
    context.db
      .collection('sales')
      .doc(SALES_NAMESPACE_ID)
      .collection('projects')
      .where('customerId', '==', customerId)
      .get(),
    context.db
      .collection('sales')
      .doc(SALES_NAMESPACE_ID)
      .collection('quatations')
      .where('customerId', '==', customerId)
      .get(),
  ]);

  await collectQuery(context, quotationSnapshots.docs, 'quotations');
  await Promise.all(projectSnapshots.docs.map((projectDoc) => collectProjectCascade(context, projectDoc.id)));
  await collectQuotationRequestsForCustomer(context, customerId);
};

const archiveAndDelete = async (
  context: CascadeDeleteContext,
  rootType: 'lead' | 'project',
  rootId: string,
  actor: AuthedUser,
) => {
  const timestamp = nowIso();
  const archiveRootRef = context.db.collection('deletionArchives').doc(context.operationId);
  await archiveRootRef.set({
    operationId: context.operationId,
    rootType,
    rootId,
    deletedAt: timestamp,
    deletedBy: {
      id: actor.id,
      fullName: actor.fullName,
      roleKey: actor.roleKey,
    },
    deletedCounts: context.deletedCounts,
    recoveryStatus: 'available',
  });

  for (let index = 0; index < context.archivedDocs.length; index += DELETE_BATCH_SIZE) {
    const chunk = context.archivedDocs.slice(index, index + DELETE_BATCH_SIZE);
    const batch = context.db.batch();
    chunk.forEach((docItem) => {
      const archiveDocRef = archiveRootRef.collection('records').doc();
      batch.set(archiveDocRef, {
        path: docItem.path,
        data: docItem.data,
        archivedAt: timestamp,
      });
      batch.delete(context.db.doc(docItem.path));
    });
    await batch.commit();
  }

  const auditRef = await context.db.collection('auditLogs').add({
    action: `${rootType}.cascade_delete`,
    entityType: rootType,
    entityId: rootId,
    performedAt: timestamp,
    performedBy: {
      id: actor.id,
      fullName: actor.fullName,
      roleKey: actor.roleKey,
    },
    deletedCounts: context.deletedCounts,
    archiveOperationId: context.operationId,
  });

  return auditRef.id;
};

export const cascadeDeleteProject = async (
  projectId: string,
  actor: AuthedUser,
): Promise<CascadeDeleteSummary> => {
  const db = getFirebaseAdminDb();
  const context: CascadeDeleteContext = {
    db,
    operationId: db.collection('deletionArchives').doc().id,
    archivedDocs: [],
    deletedCounts: {},
    visitedPaths: new Set<string>(),
  };

  const exists = await collectProjectCascade(context, projectId);
  if (!exists) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  const auditLogId = await archiveAndDelete(context, 'project', projectId, actor);
  return {
    rootType: 'project',
    rootId: projectId,
    deletedCounts: context.deletedCounts,
    archivedOperationId: context.operationId,
    auditLogId,
  };
};

export const cascadeDeleteLead = async (
  leadId: string,
  actor: AuthedUser,
): Promise<CascadeDeleteSummary> => {
  const db = getFirebaseAdminDb();
  const context: CascadeDeleteContext = {
    db,
    operationId: db.collection('deletionArchives').doc().id,
    archivedDocs: [],
    deletedCounts: {},
    visitedPaths: new Set<string>(),
  };

  const leadRef = db.collection('crm').doc(CRM_NAMESPACE_ID).collection('crm_leads').doc(leadId);
  const leadSnap = await collectSingleDoc(context, leadRef, 'leads');
  if (!leadSnap) {
    throw new Error('LEAD_NOT_FOUND');
  }

  const [leadTaskSnapshots, leadActivitySnapshots, linkedCustomerSnapshots] = await Promise.all([
    db.collection('tasks').where('leadId', '==', leadId).get(),
    leadRef.collection('activities').get(),
    db.collection('sales').doc(SALES_NAMESPACE_ID).collection('customers').where('leadId', '==', leadId).get(),
  ]);

  await Promise.all([
    collectQuery(context, leadTaskSnapshots.docs, 'tasks'),
    collectQuery(context, leadActivitySnapshots.docs, 'leadActivities'),
    collectQuotationRequestsForLead(context, leadId),
  ]);

  await Promise.all(linkedCustomerSnapshots.docs.map((customerDoc) => collectCustomerCascade(context, customerDoc.id)));

  const auditLogId = await archiveAndDelete(context, 'lead', leadId, actor);
  return {
    rootType: 'lead',
    rootId: leadId,
    deletedCounts: context.deletedCounts,
    archivedOperationId: context.operationId,
    auditLogId,
  };
};
