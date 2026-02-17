import { LeadRepository } from '@/core/ports/LeadRepository';

export const listLeadsForUser = async (repository: LeadRepository, ownerId: string) => {
  return repository.listByOwner(ownerId);
};
