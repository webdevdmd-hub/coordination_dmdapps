'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';

import { firebaseCustomerRepository } from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseProjectRepository } from '@/adapters/repositories/firebaseProjectRepository';
import { firebaseQuotationRepository } from '@/adapters/repositories/firebaseQuotationRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { useAuth } from '@/components/auth/AuthProvider';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { FilterDropdown } from '@/components/ui/FilterDropdown';
import { Customer } from '@/core/entities/customer';
import { Project } from '@/core/entities/project';
import { Quotation, QuotationLineItem, QuotationStatus } from '@/core/entities/quotation';
import { User } from '@/core/entities/user';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { formatCurrency } from '@/lib/currency';
import {
  getModuleCacheEntry,
  isModuleCacheFresh,
  MODULE_CACHE_TTL_MS,
  setModuleCacheEntry,
} from '@/lib/moduleDataCache';
import { hasPermission } from '@/lib/permissions';
import {
  filterUsersByRole,
  hasUserVisibilityAccess,
} from '@/lib/roleVisibility';

const statusOptions: Array<{ value: QuotationStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
];

const statusStyles: Record<QuotationStatus, string> = {
  draft: 'bg-surface-strong text-text',
  sent: 'bg-[#00B67A]/16 text-[#00B67A]',
  approved: 'bg-[#00B67A]/22 text-[#00B67A]',
};

type QuotationFormState = {
  quoteNumber: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  projectId: string;
  projectName: string;
  status: QuotationStatus;
  lineItems: QuotationLineItem[];
  notes: string;
  taxRate: number;
  assignedTo: string;
  sharedRoles: string[];
};

type ProjectQuickAddState = {
  name: string;
  dueDate: string;
  description: string;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const formatDate = (value: string) => {
  if (!value) {
    return '-';
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const createLineItem = (): QuotationLineItem => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  description: '',
  quantity: 1,
  unitPrice: 0,
});

const generateQuoteNumber = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(100 + Math.random() * 900);
  return `QT-${year}${month}-${random}`;
};

const calculateTotals = (items: QuotationLineItem[], taxRate: number) => {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const safeTax = Number.isFinite(taxRate) ? taxRate : 0;
  const taxAmount = subtotal * (safeTax / 100);
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total, taxRate: safeTax };
};

export default function Page() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isQuickAddProjectOpen, setIsQuickAddProjectOpen] = useState(false);
  const [quickAddProjectError, setQuickAddProjectError] = useState<string | null>(null);
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null);

  const isAdmin = !!user?.permissions.includes('admin');
  const canView = !!user && hasPermission(user.permissions, ['admin', 'quotation_view']);
  const hasUserVisibility = hasUserVisibilityAccess(user, 'quotations', user?.roleRelations);
  const canCreate = !!user && hasPermission(user.permissions, ['admin', 'quotation_create']);
  const canEdit = !!user && hasPermission(user.permissions, ['admin', 'quotation_edit']);
  const canDelete = !!user && hasPermission(user.permissions, ['admin', 'quotation_delete']);
  const canViewProjects = !!user && hasPermission(user.permissions, ['admin', 'project_view']);
  const canViewAllProjects = !!user && hasPermission(user.permissions, ['admin', 'project_view_all']);
  const canCreateProject = !!user && hasPermission(user.permissions, ['admin', 'project_create']);
  const canViewAllCustomers =
    !!user && hasPermission(user.permissions, ['admin', 'customer_view_all']);

  const emptyQuotation = (assignedTo: string): QuotationFormState => ({
    quoteNumber: generateQuoteNumber(new Date()),
    validUntil: todayKey(),
    customerId: '',
    customerName: '',
    projectId: '',
    projectName: '',
    status: 'draft',
    lineItems: [createLineItem()],
    notes: '',
    taxRate: 5,
    assignedTo,
    sharedRoles: [],
  });

  const [formState, setFormState] = useState<QuotationFormState>(() =>
    emptyQuotation(user?.id ?? ''),
  );
  const [quickAddProjectState, setQuickAddProjectState] = useState<ProjectQuickAddState>({
    name: '',
    dueDate: todayKey(),
    description: '',
  });

  const totals = useMemo(
    () => calculateTotals(formState.lineItems, formState.taxRate),
    [formState.lineItems, formState.taxRate],
  );
  const ownerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    users.forEach((profile) => map.set(profile.id, profile.fullName));
    return map;
  }, [user, users]);
  const getOwnerInitials = (ownerId: string) =>
    (ownerNameMap.get(ownerId) ?? ownerId)
      .split(' ')
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const userRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((profile) => map.set(profile.id, profile.role));
    if (user) {
      map.set(user.id, user.role);
    }
    return map;
  }, [user, users]);

  const visibleUsers = useMemo(
    () => filterUsersByRole(user, users, 'quotations', user?.roleRelations),
    [user, users],
  );

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (user) {
      map.set(user.id, user.fullName);
    }
    visibleUsers.forEach((profile) => map.set(profile.id, profile.fullName));
    const list = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    if (!hasUserVisibility) {
      return [];
    }
    return [{ id: 'all', name: 'All users' }, ...list];
  }, [hasUserVisibility, user, visibleUsers]);

  const visibleUserIds = useMemo(() => {
    const ids = new Set<string>(visibleUsers.map((profile) => profile.id));
    if (user) {
      ids.add(user.id);
    }
    return ids;
  }, [visibleUsers, user]);
  const visibleUserScope = useMemo(
    () => Array.from(visibleUserIds).sort().join(','),
    [visibleUserIds],
  );
  const quotationsCacheKey = useMemo(() => {
    if (!user) {
      return null;
    }
    const scopeKey = isAdmin
      ? 'admin'
      : hasUserVisibility
        ? `visible:${visibleUserScope}`
        : `self:${user.id}`;
    return ['quotations', user.id, ownerFilter, scopeKey].join(':');
  }, [user, ownerFilter, isAdmin, hasUserVisibility, visibleUserScope]);
  const cachedQuotesEntry = quotationsCacheKey
    ? getModuleCacheEntry<Quotation[]>(quotationsCacheKey)
    : null;
  const [quotations, setQuotations] = useState<Quotation[]>(() => cachedQuotesEntry?.data ?? []);
  const [loading, setLoading] = useState(() => !cachedQuotesEntry);

  const syncQuotations = (next: Quotation[]) => {
    setQuotations(next);
    if (quotationsCacheKey) {
      setModuleCacheEntry(quotationsCacheKey, next);
    }
  };

  const updateQuotations = (updater: (current: Quotation[]) => Quotation[]) => {
    setQuotations((current) => {
      const next = updater(current);
      if (quotationsCacheKey) {
        setModuleCacheEntry(quotationsCacheKey, next);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!user || !hasUserVisibility) {
      setUsers([]);
      return;
    }
    const loadUsers = async () => {
      const usersCacheKey = 'quotations-users';
      const cachedEntry = getModuleCacheEntry<User[]>(usersCacheKey);
      if (cachedEntry) {
        setUsers(cachedEntry.data);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        const result = await firebaseUserRepository.listAll();
        setUsers(result);
        setModuleCacheEntry(usersCacheKey, result);
      } catch {
        setUsers([]);
      }
    };
    loadUsers();
  }, [user, hasUserVisibility]);

  useEffect(() => {
    if (!user) {
      setOwnerFilter('all');
      return;
    }
    if (!hasUserVisibility) {
      setOwnerFilter('all');
    }
  }, [user, hasUserVisibility]);

  useEffect(() => {
    const loadCustomers = async () => {
      if (!user) {
        setCustomers([]);
        return;
      }
      const customersCacheKey = ['quotations-customers', user.id, isAdmin ? 'admin' : user.role].join(':');
      const cachedEntry = getModuleCacheEntry<Customer[]>(customersCacheKey);
      if (cachedEntry) {
        setCustomers(cachedEntry.data);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        if (canViewAllCustomers || isAdmin) {
          const allCustomers = await firebaseCustomerRepository.listAll();
          setCustomers(allCustomers);
          setModuleCacheEntry(customersCacheKey, allCustomers);
          return;
        }
        const result = await firebaseCustomerRepository.listForUser(user.id, user.role);
        setCustomers(result);
        setModuleCacheEntry(customersCacheKey, result);
      } catch {
        setCustomers([]);
      }
    };
    loadCustomers();
  }, [user, isAdmin, canViewAllCustomers]);

  useEffect(() => {
    const loadProjects = async () => {
      if (!user || !canViewProjects) {
        setProjects([]);
        return;
      }
      const projectsListCacheKey = ['quotations-projects', user.id, canViewAllProjects ? 'all' : user.role].join(':');
      const cachedEntry = getModuleCacheEntry<Project[]>(projectsListCacheKey);
      if (cachedEntry) {
        setProjects(cachedEntry.data);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      }
      try {
        const result = canViewAllProjects
          ? await firebaseProjectRepository.listAll()
          : await firebaseProjectRepository.listForUser(user.id, user.role);
        setProjects(result);
        setModuleCacheEntry(projectsListCacheKey, result);
      } catch {
        setProjects([]);
      }
    };
    loadProjects();
  }, [user, canViewProjects, canViewAllProjects]);

  useEffect(() => {
    const cachedEntry = quotationsCacheKey
      ? getModuleCacheEntry<Quotation[]>(quotationsCacheKey)
      : null;
    if (!cachedEntry) {
      return;
    }
    setQuotations(cachedEntry.data);
    setLoading(false);
  }, [quotationsCacheKey]);

  useEffect(() => {
    const loadQuotations = async () => {
      if (!user) {
        setQuotations([]);
        setLoading(false);
        return;
      }
      if (!canView) {
        setQuotations([]);
        setLoading(false);
        return;
      }
      const cachedEntry = quotationsCacheKey
        ? getModuleCacheEntry<Quotation[]>(quotationsCacheKey)
        : null;
      if (cachedEntry) {
        setQuotations(cachedEntry.data);
        setLoading(false);
        if (isModuleCacheFresh(cachedEntry, MODULE_CACHE_TTL_MS)) {
          return;
        }
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        let nextQuotes: Quotation[] = [];
        if (user.permissions.includes('admin')) {
          const allQuotes = await firebaseQuotationRepository.listAll();
          if (ownerFilter === 'all') {
            nextQuotes = allQuotes;
          } else {
            const selectedRole = userRoleMap.get(ownerFilter);
            nextQuotes = allQuotes.filter(
              (quote) =>
                quote.assignedTo === ownerFilter ||
                (selectedRole ? quote.sharedRoles.includes(selectedRole) : false),
            );
          }
        } else if (hasUserVisibility) {
          const allQuotes = await firebaseQuotationRepository.listAll();
          const sameRoleQuotes = allQuotes.filter((quote) =>
            visibleUserIds.has(quote.assignedTo),
          );
          if (ownerFilter === 'all') {
            nextQuotes = sameRoleQuotes;
          } else {
            const selectedRole = userRoleMap.get(ownerFilter);
            nextQuotes = sameRoleQuotes.filter(
              (quote) =>
                quote.assignedTo === ownerFilter ||
                (selectedRole ? quote.sharedRoles.includes(selectedRole) : false),
            );
          }
        } else {
          nextQuotes = await firebaseQuotationRepository.listForUser(user.id, user.role);
        }
        syncQuotations(nextQuotes);
      } catch {
        setError('Unable to load quotations. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadQuotations();
  }, [
    user,
    canView,
    hasUserVisibility,
    ownerFilter,
    userRoleMap,
    visibleUserIds,
    quotationsCacheKey,
  ]);

  const filteredQuotations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotations.filter((quote) => {
      const matchesStatus = statusFilter === 'all' ? true : quote.status === statusFilter;
      const matchesSearch =
        term.length === 0 ||
        [quote.customerName, quote.quoteNumber, quote.projectName ?? ''].some((value) =>
          value.toLowerCase().includes(term),
        );
      return matchesStatus && matchesSearch;
    });
  }, [quotations, search, statusFilter]);

  const totalsByStatus = useMemo(() => {
    const draft = quotations.filter((quote) => quote.status === 'draft').length;
    const sent = quotations.filter((quote) => quote.status === 'sent').length;
    const approved = quotations.filter((quote) => quote.status === 'approved').length;
    return { draft, sent, approved };
  }, [quotations]);
  const quoteStatusFilterOptions = ['all', ...statusOptions.map((status) => status.value)] as const;
  const selectedQuoteStatusIndex = Math.max(0, quoteStatusFilterOptions.indexOf(statusFilter));

  const handleOpenCreate = () => {
    if (!user) {
      return;
    }
    setSelectedQuotation(null);
    setFormState(emptyQuotation(user.id));
    setIsQuickAddProjectOpen(false);
    setQuickAddProjectError(null);
    setQuickAddProjectState({ name: '', dueDate: todayKey(), description: '' });
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (quote: Quotation) => {
    setSelectedQuotation(quote);
    setFormState({
      quoteNumber: quote.quoteNumber,
      validUntil: quote.validUntil,
      customerId: quote.customerId,
      customerName: quote.customerName,
      projectId: quote.projectId ?? '',
      projectName: quote.projectName ?? '',
      status: quote.status,
      lineItems: quote.lineItems.length ? quote.lineItems : [createLineItem()],
      notes: quote.notes,
      taxRate: quote.taxRate ?? 0,
      assignedTo: quote.assignedTo,
      sharedRoles: quote.sharedRoles ?? [],
    });
    setIsQuickAddProjectOpen(false);
    setQuickAddProjectError(null);
    setQuickAddProjectState({ name: '', dueDate: todayKey(), description: '' });
    setIsEditOpen(true);
  };

  const handleCloseModal = () => {
    setIsCreateOpen(false);
    setIsEditOpen(false);
    setIsQuickAddProjectOpen(false);
    setQuickAddProjectError(null);
  };

  const handleSelectCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) {
      return;
    }
    const projectForCustomer = projects.find(
      (item) => item.id === formState.projectId && item.customerId === customer.id,
    );
    setFormState((prev) => ({
      ...prev,
      customerId: customer.id,
      customerName: customer.companyName,
      projectId: projectForCustomer ? prev.projectId : '',
      projectName: projectForCustomer ? prev.projectName : '',
      assignedTo: customer.assignedTo,
      sharedRoles: customer.sharedRoles ?? [],
    }));
    setQuickAddProjectState((prev) => ({
      ...prev,
      name: prev.name || `${customer.companyName} Project`,
    }));
  };

  const handleSelectProject = (projectId: string) => {
    if (!projectId) {
      setFormState((prev) => ({ ...prev, projectId: '', projectName: '' }));
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    setFormState((prev) => ({
      ...prev,
      projectId: project.id,
      projectName: project.name,
    }));
  };

  const handleQuickAddProject = async () => {
    if (!user || !canCreateProject) {
      return;
    }
    if (!formState.customerId || !formState.customerName) {
      setQuickAddProjectError('Select a customer before creating a project.');
      return;
    }
    const name = quickAddProjectState.name.trim();
    if (!name) {
      setQuickAddProjectError('Project name is required.');
      return;
    }
    setIsCreatingProject(true);
    setQuickAddProjectError(null);
    try {
      const created = await firebaseProjectRepository.create({
        name,
        customerId: formState.customerId,
        customerName: formState.customerName,
        assignedTo: formState.assignedTo || user.id,
        sharedRoles: formState.sharedRoles ?? [],
        startDate: todayKey(),
        dueDate: quickAddProjectState.dueDate || todayKey(),
        value: 0,
        status: 'not-started',
        description: quickAddProjectState.description.trim(),
        createdBy: user.id,
      });
      setProjects((prev) => [created, ...prev]);
      setFormState((prev) => ({
        ...prev,
        projectId: created.id,
        projectName: created.name,
      }));
      setQuickAddProjectState({ name: '', dueDate: todayKey(), description: '' });
      setIsQuickAddProjectOpen(false);
    } catch {
      setQuickAddProjectError('Unable to create project. Please try again.');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const syncProjectTimelineForQuotation = async (
    quote: Pick<
      Quotation,
      'quoteNumber' | 'customerName' | 'projectId' | 'projectName' | 'status' | 'validUntil' | 'total'
    >,
    previousStatus?: QuotationStatus,
  ) => {
    if (!user || !quote.projectId) {
      return;
    }
    const activitiesRef = collection(
      getFirebaseDb(),
      'sales',
      'main',
      'projects',
      quote.projectId,
      'activities',
    );
    const now = new Date().toISOString();
    const entries: Array<{ type: string; note: string }> = [];

    if (previousStatus && previousStatus !== quote.status) {
      entries.push({
        type: 'quotation_status',
        note: `Quotation ${quote.quoteNumber} status changed from ${previousStatus} to ${quote.status}.`,
      });
    } else if (!previousStatus) {
      entries.push({
        type: 'quotation_status',
        note: `Quotation ${quote.quoteNumber} linked to this project with status ${quote.status}.`,
      });
    }

    if (quote.status === 'approved' && previousStatus !== 'approved') {
      entries.push({
        type: 'quotation_finalized',
        note: `Quotation ${quote.quoteNumber} finalized for ${quote.customerName}. Total ${formatCurrency(
          quote.total,
        )}.`,
      });
      entries.push({
        type: 'quotation_deadline',
        note: `Quotation deadline: valid until ${formatDate(quote.validUntil)} (quotation ${
          quote.quoteNumber
        }).`,
      });
    }

    if (entries.length === 0) {
      return;
    }

    await Promise.all(
      entries.map((entry) =>
        addDoc(activitiesRef, {
          type: entry.type,
          note: entry.note,
          date: now,
          createdBy: user.id,
        }),
      ),
    );
  };

  const handleAddLineItem = () => {
    setFormState((prev) => ({
      ...prev,
      lineItems: [...prev.lineItems, createLineItem()],
    }));
  };

  const handleRemoveLineItem = (id: string) => {
    setFormState((prev) => {
      const next = prev.lineItems.filter((item) => item.id !== id);
      return { ...prev, lineItems: next.length ? next : [createLineItem()] };
    });
  };

  const handleLineItemChange = (
    id: string,
    field: keyof Pick<QuotationLineItem, 'description' | 'quantity' | 'unitPrice'>,
    value: string,
  ) => {
    setFormState((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === 'description'
                  ? value
                  : Number.isFinite(Number(value))
                    ? Number(value)
                    : 0,
            }
          : item,
      ),
    }));
  };
  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError('You must be signed in to save quotations.');
      return;
    }
    if (!formState.customerId || !formState.validUntil) {
      setError('Customer and valid until date are required.');
      return;
    }
    const isEditing = !!selectedQuotation;
    if (isEditing && !canEdit) {
      setError('You do not have permission to edit quotations.');
      return;
    }
    if (!isEditing && !canCreate) {
      setError('You do not have permission to create quotations.');
      return;
    }
    if (isEditing && !isAdmin && selectedQuotation?.assignedTo !== user.id) {
      setError('You can only edit quotations assigned to you.');
      return;
    }

    const { subtotal, taxAmount, total, taxRate } = calculateTotals(
      formState.lineItems,
      formState.taxRate,
    );

    const updates = {
      ...formState,
      notes: formState.notes.trim(),
      projectId: formState.projectId || '',
      projectName: formState.projectName || '',
      lineItems: formState.lineItems.map((item) => ({
        ...item,
        description: item.description.trim(),
      })),
      subtotal,
      taxAmount,
      total,
      taxRate,
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEditing && selectedQuotation) {
        const previousStatus = selectedQuotation.status;
        const updated = await firebaseQuotationRepository.update(selectedQuotation.id, {
          ...updates,
          updatedAt: new Date().toISOString(),
        });
        updateQuotations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        await syncProjectTimelineForQuotation(updated, previousStatus);
      } else {
        const created = await firebaseQuotationRepository.create({
          ...updates,
          createdBy: user.id,
        });
        updateQuotations((prev) => [created, ...prev]);
        await syncProjectTimelineForQuotation(created);
      }
      handleCloseModal();
    } catch {
      setError('Unable to save quotation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedQuotation) {
      return;
    }
    if (!user) {
      setError('You must be signed in to delete quotations.');
      return;
    }
    if (!canDelete) {
      setError('You do not have permission to delete quotations.');
      return;
    }
    if (!isAdmin && selectedQuotation.assignedTo !== user.id) {
      setError('You can only delete quotations assigned to you.');
      return;
    }
    const confirmed = window.confirm('Delete this quotation? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await firebaseQuotationRepository.delete(selectedQuotation.id);
      updateQuotations((prev) => prev.filter((item) => item.id !== selectedQuotation.id));
      handleCloseModal();
    } catch {
      setError('Unable to delete quotation. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleQuickStatusChange = async (quote: Quotation, nextStatus: QuotationStatus) => {
    if (!user || !canEdit) {
      return;
    }
    if (!isAdmin && quote.assignedTo !== user.id) {
      return;
    }
    try {
      const updated = await firebaseQuotationRepository.update(quote.id, {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      updateQuotations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      await syncProjectTimelineForQuotation(updated, quote.status);
    } catch {
      setError('Unable to update quotation status.');
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted/80">
              Quotations
            </p>
            <h1 className="font-display text-5xl text-text">Quote management</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted">
              Create quotations with itemized pricing, tax, and approval tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasUserVisibility ? (
              <FilterDropdown
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={ownerOptions}
                ariaLabel="Quotation owner filter"
              />
            ) : null}
            <div className="relative grid grid-cols-2 rounded-2xl border border-border bg-surface p-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2 left-2 top-2 rounded-xl bg-text shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300 ease-out"
                style={{
                  width: 'calc((100% - 1rem) / 2)',
                  transform: viewMode === 'card' ? 'translateX(100%)' : 'translateX(0)',
                }}
              />
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                  viewMode === 'list' ? 'text-white' : 'text-muted hover:text-text'
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('card')}
                className={`relative z-[1] rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-200 ${
                  viewMode === 'card' ? 'text-white' : 'text-muted hover:text-text'
                }`}
              >
                Cards
              </button>
            </div>
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={!canCreate}
              className="rounded-full border border-[#00B67A]/30 bg-[#00B67A] px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-[1px] hover:bg-[#009f6b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              New quotation
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Draft</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totalsByStatus.draft}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Sent</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totalsByStatus.sent}</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted/80">Approved</p>
            <p className="mt-4 text-5xl font-semibold text-text">{totalsByStatus.approved}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-xs text-muted md:w-auto md:rounded-full">
              <input
                type="search"
                placeholder="Search quotations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted/70 md:w-48"
              />
            </div>
            <div className="relative w-full rounded-lg border border-border bg-[var(--surface-muted)] p-0.5 md:w-auto md:rounded-2xl md:p-1">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-emerald-500 shadow-[0_8px_16px_rgba(16,185,129,0.25)] transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${quoteStatusFilterOptions.length})`,
                  transform: `translateX(calc(${selectedQuoteStatusIndex} * 100%))`,
                }}
              />
              <div
                className="relative z-[1] grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${quoteStatusFilterOptions.length}, minmax(0, 1fr))`,
                }}
              >
                {quoteStatusFilterOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-md px-1.5 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] transition md:rounded-xl md:px-4 md:py-2 md:text-[11px] md:tracking-[0.18em] ${
                      statusFilter === status ? 'text-white' : 'text-muted hover:text-text'
                    }`}
                  >
                    {status === 'all'
                      ? 'All'
                      : statusOptions.find((option) => option.value === status)?.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-xs text-muted">{filteredQuotations.length} quotations</div>
        </div>
        {!canView ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            You do not have permission to view quotations.
          </div>
        ) : loading ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-6 text-sm text-muted">
            Loading quotations...
          </div>
        ) : viewMode === 'card' ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {filteredQuotations.map((quote) => (
              <div key={quote.id} className="rounded-3xl border border-border bg-surface p-4 shadow-soft">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted/80">
                      {quote.quoteNumber}
                    </p>
                    <h2 className="mt-1 font-display text-lg text-text">{quote.customerName}</h2>
                    <div className="mt-1 space-y-1 text-[11px] text-muted">
                      <p>Project: {quote.projectName || '-'}</p>
                      <p>
                        Owner <span className="font-semibold text-text">{ownerNameMap.get(quote.assignedTo) ?? quote.assignedTo}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                        statusStyles[quote.status]
                      }`}
                    >
                      {statusOptions.find((option) => option.value === quote.status)?.label}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      {formatDate(quote.validUntil)}
                    </span>
                    <span className="rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs text-muted">
                      {formatCurrency(quote.total)}
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 grid w-full grid-cols-3 divide-x divide-border py-0.5 text-center">
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Owner</p>
                    <p className="mt-1 text-sm font-semibold text-text">{getOwnerInitials(quote.assignedTo)}</p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Status</p>
                    <p className="mt-1 text-sm font-semibold text-text">
                      {statusOptions.find((option) => option.value === quote.status)?.label}
                    </p>
                  </div>
                  <div className="px-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">Total</p>
                    <p className="mt-1 text-sm font-semibold text-text">{formatCurrency(quote.total)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(quote)}
                      className="rounded-xl bg-[#00B67A]/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#00B67A]"
                    >
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface">
            {filteredQuotations.map((quote) => (
              <div
                key={quote.id}
                className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_1.2fr_1fr_1fr_1fr_auto] md:items-center md:gap-2 md:px-4"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-[var(--surface-muted)] text-[11px] font-semibold uppercase tracking-[0.12em] text-text">
                    {getOwnerInitials(quote.assignedTo)}
                  </span>
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-text">
                    {ownerNameMap.get(quote.assignedTo) ?? quote.assignedTo}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text">{quote.quoteNumber}</p>
                  <p className="truncate text-xs text-muted">{quote.customerName}</p>
                </div>

                <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  {quote.projectName || '-'}
                </p>

                <p className="text-sm text-text">{formatDate(quote.validUntil)}</p>

                <div className="flex items-center gap-2">
                  <select
                    value={quote.status}
                    onChange={(event) =>
                      handleQuickStatusChange(quote, event.target.value as QuotationStatus)
                    }
                    className="rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text outline-none"
                    disabled={!canEdit || (!isAdmin && quote.assignedTo !== user?.id)}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="inline-flex rounded-full border border-border bg-[var(--surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-text">
                    {formatCurrency(quote.total)}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(quote)}
                      className="rounded-xl border border-border bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-text"
                    >
                      Edit
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedQuotation(quote);
                        setIsEditOpen(true);
                      }}
                      className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {filteredQuotations.length === 0 ? (
              <div className="px-5 py-6 text-sm text-muted">No quotations found yet.</div>
            ) : null}
          </div>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-border/60 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {(isCreateOpen || isEditOpen) && (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur"
          onClick={handleCloseModal}
        >
          <DraggablePanel
            className="w-full max-w-3xl rounded-3xl border border-border/60 bg-surface/95 p-6 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl text-text">
                  {selectedQuotation ? 'Edit quotation' : 'New quotation'}
                </h3>
                <p className="mt-2 text-sm text-muted">
                  Build a quotation with line items, tax, and validity date.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleSave}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Quotation number
                  </label>
                  <input
                    value={formState.quoteNumber}
                    readOnly
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Valid until
                  </label>
                  <input
                    type="date"
                    required
                    value={formState.validUntil}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, validUntil: event.target.value }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Customer
                  </label>
                  <select
                    value={formState.customerId}
                    onChange={(event) => handleSelectCustomer(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    <option value="">Select customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.companyName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: event.target.value as QuotationStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Project
                  </label>
                  {canCreateProject ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsQuickAddProjectOpen(true);
                        setQuickAddProjectError(null);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-bg/70 text-sm font-semibold text-muted transition hover:bg-hover/80 hover:text-text"
                      aria-label="Quick add project"
                      title="Quick add project"
                    >
                      +
                    </button>
                  ) : null}
                </div>
                <select
                  value={formState.projectId}
                  onChange={(event) => handleSelectProject(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                >
                  <option value="">Select project</option>
                  {projects
                    .filter((project) =>
                      formState.customerId ? project.customerId === formState.customerId : true,
                    )
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    Line items
                  </label>
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="text-xs font-semibold uppercase tracking-[0.24em] text-[#00B67A] hover:text-[#009f6b]"
                  >
                    + Add line item
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {formState.lineItems.map((item) => (
                    <div key={item.id} className="grid gap-3 md:grid-cols-[2fr_0.6fr_0.8fr_auto]">
                      <input
                        placeholder="Description"
                        value={item.description}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'description', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'quantity', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <input
                        type="number"
                        min="0"
                        value={item.unitPrice}
                        onChange={(event) =>
                          handleLineItemChange(item.id, 'unitPrice', event.target.value)
                        }
                        className="rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(item.id)}
                        className="rounded-full border border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-bg/70 p-4">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-muted">
                  <span>Tax</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={formState.taxRate}
                      onChange={(event) =>
                        setFormState((prev) => ({
                          ...prev,
                          taxRate: Number(event.target.value),
                        }))
                      }
                      className="w-16 rounded-xl border border-border/60 bg-bg/70 px-2 py-1 text-sm text-text outline-none"
                    />
                    <span>%</span>
                    <span>{formatCurrency(totals.taxAmount)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-base font-semibold text-text">
                  <span>Total</span>
                  <span>{formatCurrency(totals.total)}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                  Notes
                </label>
                <textarea
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="Additional notes..."
                  className="mt-2 min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {selectedQuotation && canDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-full border border-border/60 bg-[#00B67A]/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:-translate-y-[1px] hover:bg-[#009f6b]/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving
                    ? 'Saving...'
                    : selectedQuotation
                      ? 'Save quotation'
                      : 'Create quotation'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      )}

      {isQuickAddProjectOpen && (isCreateOpen || isEditOpen) ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm"
          onClick={() => setIsQuickAddProjectOpen(false)}
        >
          <DraggablePanel
            className="w-full max-w-xl rounded-3xl border border-border/60 bg-surface/95 p-5 shadow-floating"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl text-text">Create project</h3>
                <p className="mt-1 text-sm text-muted">
                  Add a project and continue quotation without leaving this screen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddProjectOpen(false)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                    Project name
                  </label>
                  <input
                    value={quickAddProjectState.name}
                    onChange={(event) =>
                      setQuickAddProjectState((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder="New project"
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={quickAddProjectState.dueDate}
                    onChange={(event) =>
                      setQuickAddProjectState((prev) => ({
                        ...prev,
                        dueDate: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">
                  Description
                </label>
                <textarea
                  value={quickAddProjectState.description}
                  onChange={(event) =>
                    setQuickAddProjectState((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  className="mt-2 min-h-[100px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
                  placeholder="Project summary..."
                />
              </div>
              {quickAddProjectError ? (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {quickAddProjectError}
                </div>
              ) : null}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleQuickAddProject}
                  disabled={isCreatingProject}
                  className="rounded-full border border-border/60 bg-[#00B67A]/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white transition hover:bg-[#009f6b]/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreatingProject ? 'Creating...' : 'Create project'}
                </button>
              </div>
            </div>
          </DraggablePanel>
        </div>
      ) : null}
    </div>
  );
}








