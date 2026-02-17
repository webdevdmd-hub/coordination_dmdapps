import { CreateUserInput, UserRepository } from '@/core/ports/UserRepository';

export const createUser = async (repository: UserRepository, input: CreateUserInput) => {
  return repository.create(input);
};
