import { NextResponse } from 'next/server';

import { cascadeDeleteProject } from '@/server/cascadeDeletion';
import { getAuthedUserFromSession } from '@/lib/auth/serverSession';

export const runtime = 'nodejs';

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authedUser = await getAuthedUserFromSession(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }
  if (
    !authedUser.permissions.includes('admin') &&
    !authedUser.permissions.includes('project_delete')
  ) {
    return toErrorResponse('You do not have permission to delete projects.', 403);
  }

  const { id } = await context.params;
  const projectId = id?.trim();
  if (!projectId) {
    return toErrorResponse('Project id is required.');
  }

  try {
    const result = await cascadeDeleteProject(projectId, authedUser);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
      return toErrorResponse('Project not found.', 404);
    }
    return toErrorResponse('Unable to delete project.', 500);
  }
}
