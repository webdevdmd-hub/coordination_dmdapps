export type CustomerStatus =
  | 'active'
  | 'inactive'
  | 'new'
  | 'contacted'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

export type CustomerAddress = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
};

export type Customer = {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  salutation?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  displayNameSecondary?: string;
  vatNumber?: string;
  website?: string;
  workPhone?: string;
  mobile?: string;
  customerLanguage?: string;
  currency?: string;
  taxTreatment?: string;
  placeOfSupply?: string;
  paymentTerms?: string;
  enablePortal?: boolean;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  remarks?: string;
  source: string;
  status: CustomerStatus;
  assignedTo: string;
  sharedRoles: string[];
  createdBy: string;
  leadId?: string;
  createdAt: string;
  updatedAt: string;
};
