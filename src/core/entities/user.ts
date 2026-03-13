export type UserRole = 'manager' | 'agent' | (string & {});

export type User = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
};
