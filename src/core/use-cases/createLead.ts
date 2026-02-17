import { LeadRepository, CreateLeadInput } from '@/core/ports/LeadRepository';

export const createLead = async (repository: LeadRepository, input: CreateLeadInput) => {
  const now = new Date().toISOString();
  const lead = await repository.create({
    ...input,
    createdAt: input.createdAt ?? now,
    lastTouchedAt: input.lastTouchedAt ?? now,
  });
  await repository.addActivity(lead.id, {
    type: 'note',
    note: 'Lead created',
    date: now,
    createdBy: input.ownerId,
  });
  return lead;
};
