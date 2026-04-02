import { NextResponse } from 'next/server';

import { getAuthedUserFromSession } from '@/lib/auth/serverSession';
import { cascadeDeleteLead } from '@/server/cascadeDeletion';

export const runtime = 'nodejs';

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authedUser = await getAuthedUserFromSession(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }
  if (
    !authedUser.permissions.includes('admin') &&
    !authedUser.permissions.includes('lead_delete')
  ) {
    return toErrorResponse('You do not have permission to delete leads.', 403);
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!leadId) {
    return toErrorResponse('Lead id is required.');
  }

  try {
    const result = await cascadeDeleteLead(leadId, authedUser);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === 'LEAD_NOT_FOUND') {
      return toErrorResponse('Lead not found.', 404);
    }
    return toErrorResponse('Unable to delete lead.', 500);
  }
}
