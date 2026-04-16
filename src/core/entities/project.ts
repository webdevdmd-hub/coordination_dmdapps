export type ProjectStatus =
  | 'unassigned'
  | 'not-started'
  | 'in-progress'
  | 'on-hold'
  | 'completed'
  | 'canceled';
export type ProjectStatusOverride = 'completed' | 'canceled';

export type Project = {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  assignedTo: string;
  sharedRoles: string[];
  startDate: string;
  dueDate: string;
  value: number;
  status: ProjectStatus;
  statusOverride?: ProjectStatusOverride | null;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
