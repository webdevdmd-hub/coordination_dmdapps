export type ProjectStatus = 'not-started' | 'in-progress' | 'on-hold' | 'completed' | 'canceled';

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
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
