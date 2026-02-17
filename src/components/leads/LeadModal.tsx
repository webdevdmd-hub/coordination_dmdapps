'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  findCustomerByEmail,
  findCustomerByLeadId,
  firebaseCustomerRepository,
} from '@/adapters/repositories/firebaseCustomerRepository';
import { firebaseLeadRepository } from '@/adapters/repositories/firebaseLeadRepository';
import { firebaseQuotationRequestRepository } from '@/adapters/repositories/firebaseQuotationRequestRepository';
import { firebaseUserRepository } from '@/adapters/repositories/firebaseUserRepository';
import { Lead, LeadActivity, LeadActivityType, LeadStatus } from '@/core/entities/lead';
import { CustomerStatus } from '@/core/entities/customer';
import { User } from '@/core/entities/user';
import { StatusPill } from '@/components/ui/StatusPill';
import { DraggablePanel } from '@/components/ui/DraggablePanel';
import { Modal, ModalHeader, ModalTitle } from '@/components/ui/Modal';
import { useTaskModal } from '@/components/tasks/TaskModalProvider';
import { useAuth } from '@/components/auth/AuthProvider';
import { formatCurrency } from '@/lib/currency';
import { hasPermission } from '@/lib/permissions';
import { fetchRoleSummaries, RoleSummary } from '@/lib/roles';
import { filterAssignableUsers } from '@/lib/assignees';
import { buildRecipientList, emitNotificationEventSafe } from '@/lib/notifications';

type LeadModalProps = {
  lead: Lead | null;
  ownerNameMap?: Record<string, string>;
  sourceOptions?: string[];
  canManageSources?: boolean;
  onCreateSource?: (name: string) => Promise<string | null>;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Lead>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  canEdit: boolean;
  canDelete: boolean;
  currentUserId?: string;
};

const formatStatusLabel = (status: LeadStatus) =>
  status
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const formatFollowUpWhen = (value: Date) => {
  const day = `${value.getDate()}`.padStart(2, '0');
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const year = value.getFullYear();
  const rawHours = value.getHours();
  const hours = rawHours % 12 || 12;
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  const period = rawHours >= 12 ? 'PM' : 'AM';
  return `${day}/${month}/${year} ${hours}:${minutes} ${period}`;
};

const parseFollowUpWhen = (value: string) => {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  const [, day, month, year, hourValue, minuteValue, period] = match;
  let hours = Number(hourValue);
  if (period.toUpperCase() === 'PM' && hours < 12) {
    hours += 12;
  }
  if (period.toUpperCase() === 'AM' && hours === 12) {
    hours = 0;
  }
  return new Date(Number(year), Number(month) - 1, Number(day), hours, Number(minuteValue));
};

const formatTimelineDate = (value?: string) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const RFQ_TAGS = [
  'Estimate',
  'Lux Calculation',
  'Lighting Layout',
  'Technical Data Sheet',
  'Material Submittal',
  'Compliance Sheet',
];

const RFQ_PRIORITY_OPTIONS: Array<{ value: 'low' | 'medium' | 'high'; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function LeadModal({
  lead,
  ownerNameMap,
  sourceOptions = [],
  canManageSources = false,
  onCreateSource,
  onClose,
  onUpdate,
  onDelete,
  canEdit,
  canDelete,
  currentUserId,
}: LeadModalProps) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [isLoggingFollowUp, setIsLoggingFollowUp] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isRequestingRfq, setIsRequestingRfq] = useState(false);
  const { openTaskModal, isSubmitting: isTaskSubmitting } = useTaskModal();
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [convertedCustomerId, setConvertedCustomerId] = useState<string | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [rfqError, setRfqError] = useState<string | null>(null);
  const [isRfqModalOpen, setIsRfqModalOpen] = useState(false);
  const [rfqPriority, setRfqPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [rfqRecipients, setRfqRecipients] = useState<string[]>([]);
  const [rfqRecipientPick, setRfqRecipientPick] = useState('');
  const [rfqNotes, setRfqNotes] = useState('');
  const [rfqTags, setRfqTags] = useState<string[]>([]);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [assignableCustomerUsers, setAssignableCustomerUsers] = useState<User[]>([]);
  const [assignableCustomerRoles, setAssignableCustomerRoles] = useState<RoleSummary[]>([]);
  const [rfqRecipientGroups, setRfqRecipientGroups] = useState<
    Array<{ roleKey: string; roleName: string; users: Array<{ id: string; name: string }> }>
  >([]);
  const [followUpType, setFollowUpType] = useState<LeadActivityType>('call');
  const [followUpWhen, setFollowUpWhen] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [convertForm, setConvertForm] = useState({
    companyName: '',
    contactPerson: '',
    email: '',
    phone: '',
    source: '',
    status: 'active' as CustomerStatus,
    assignedTo: '',
  });
  const [formState, setFormState] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    value: '',
    source: '',
    status: 'new' as LeadStatus,
  });

  const canAssignCustomers =
    !!user && hasPermission(user.permissions, ['admin', 'customer_assign']);

  const activityDotClass = (activity: LeadActivity) => {
    const note = activity.note.toLowerCase();
    if (note.includes('rfq')) {
      return 'bg-emerald-500';
    }
    if (note.includes('convert')) {
      return 'bg-indigo-500';
    }
    if (note.includes('task')) {
      return 'bg-amber-500';
    }
    if (note.includes('updated')) {
      return 'bg-orange-500';
    }
    if (activity.type === 'meeting') {
      return 'bg-purple-500';
    }
    if (activity.type === 'email') {
      return 'bg-sky-500';
    }
    if (activity.type === 'call') {
      return 'bg-rose-500';
    }
    if (activity.type === 'note') {
      return 'bg-slate-400';
    }
    return 'bg-blue-500';
  };

  useEffect(() => {
    if (!lead) {
      return;
    }
    setIsEditing(false);
    setIsAddingSource(false);
    setIsFabOpen(false);
    setIsFollowUpOpen(false);
    setIsLoggingFollowUp(false);
    setIsConverting(false);
    setIsRequestingRfq(false);
    setIsConvertOpen(false);
    setConvertedCustomerId(null);
    setConversionError(null);
    setRfqError(null);
    setIsRfqModalOpen(false);
    setFollowUpType('call');
    setFollowUpWhen('');
    setFollowUpNotes('');
    setRfqPriority('medium');
    setRfqRecipients([]);
    setRfqRecipientPick('');
    setRfqNotes('');
    setRfqTags([]);
    setIsTimelineOpen(false);
    setNewSourceName('');
    setConvertForm({
      companyName: lead.company,
      contactPerson: lead.name,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      status: (lead.status as CustomerStatus) ?? 'active',
      assignedTo: lead.ownerId,
    });
    setFormState({
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      value: String(lead.value ?? ''),
      source: lead.source,
      status: lead.status as LeadStatus,
    });
  }, [lead]);

  useEffect(() => {
    if (!lead || !canAssignCustomers) {
      setAssignableCustomerUsers([]);
      setAssignableCustomerRoles([]);
      return;
    }
    let isActive = true;
    const loadAssignees = async () => {
      try {
        const [users, roles] = await Promise.all([
          firebaseUserRepository.listAll(),
          fetchRoleSummaries(),
        ]);
        if (!isActive) {
          return;
        }
        setAssignableCustomerUsers(users);
        setAssignableCustomerRoles(roles);
      } catch {
        if (isActive) {
          setAssignableCustomerUsers([]);
          setAssignableCustomerRoles([]);
        }
      }
    };
    loadAssignees();
    return () => {
      isActive = false;
    };
  }, [lead, canAssignCustomers]);

  useEffect(() => {
    if (!lead) {
      setActivities([]);
      return;
    }
    const loadActivities = async () => {
      setIsLoadingActivities(true);
      try {
        const result = await firebaseLeadRepository.listActivities(lead.id);
        setActivities(result);
      } catch {
        setActivities([]);
      } finally {
        setIsLoadingActivities(false);
      }
    };
    loadActivities();
  }, [lead]);

  useEffect(() => {
    if (!lead) {
      return;
    }
    const checkConversion = async () => {
      const byLead = await findCustomerByLeadId(lead.id);
      setConvertedCustomerId(byLead?.id ?? null);
    };
    checkConversion();
  }, [lead]);

  useEffect(() => {
    if (!lead) {
      setRfqRecipientGroups([]);
      return;
    }
    let isActive = true;
    const loadRecipients = async () => {
      try {
        const [roles, users] = await Promise.all([
          fetchRoleSummaries(),
          firebaseUserRepository.listAll(),
        ]);
        if (!isActive) {
          return;
        }
        const roleMap = new Map(roles.map((role) => [role.key.trim().toLowerCase(), role]));
        const grouped = new Map<
          string,
          { roleKey: string; roleName: string; users: Array<{ id: string; name: string }> }
        >();
        users.forEach((userItem) => {
          if (!userItem.active) {
            return;
          }
          const roleKey = userItem.role?.trim().toLowerCase();
          const role = roleKey ? roleMap.get(roleKey) : null;
          if (!role) {
            return;
          }
          if (role.key === 'admin' || role.permissions.includes('admin')) {
            return;
          }
          if (!role.permissions.includes('quotation_request_assign')) {
            return;
          }
          const entry = grouped.get(role.key) ?? {
            roleKey: role.key,
            roleName: role.name,
            users: [],
          };
          entry.users.push({ id: userItem.id, name: userItem.fullName });
          grouped.set(role.key, entry);
        });
        const groups = Array.from(grouped.values()).map((group) => ({
          ...group,
          users: group.users.sort((a, b) => a.name.localeCompare(b.name)),
        }));
        groups.sort((a, b) => a.roleName.localeCompare(b.roleName));
        setRfqRecipientGroups(groups);
      } catch {
        if (isActive) {
          setRfqRecipientGroups([]);
        }
      }
    };
    loadRecipients();
    return () => {
      isActive = false;
    };
  }, [lead]);

  const rfqRecipientsById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; roleKey: string }>();
    rfqRecipientGroups.forEach((group) => {
      group.users.forEach((userItem) => {
        map.set(userItem.id, { id: userItem.id, name: userItem.name, roleKey: group.roleKey });
      });
    });
    return map;
  }, [rfqRecipientGroups]);

  const customerAssignees = useMemo(() => {
    return filterAssignableUsers(
      assignableCustomerUsers,
      assignableCustomerRoles,
      'customer_assign',
    );
  }, [assignableCustomerUsers, assignableCustomerRoles]);

  if (!lead) {
    return null;
  }

  const ownerName = ownerNameMap?.[lead.ownerId] ?? lead.ownerId;
  const isConverted = !!convertedCustomerId;
  const canRequestRfq =
    !!user && hasPermission(user.permissions, ['admin', 'quotation_request_create']);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    const success = await onUpdate(lead.id, {
      name: formState.name.trim(),
      company: formState.company.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      source: formState.source.trim(),
      status: formState.status,
      value: Number(formState.value) || 0,
    });
    setIsSaving(false);
    if (success) {
      setIsEditing(false);
      const refreshed = await firebaseLeadRepository.listActivities(lead.id);
      setActivities(refreshed);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }
    const confirmed = window.confirm('Delete this lead? This action cannot be undone.');
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    const success = await onDelete(lead.id);
    setIsDeleting(false);
    if (success) {
      onClose();
    }
  };

  const handleFollowUp = () => {
    setFollowUpType('call');
    setFollowUpWhen(formatFollowUpWhen(new Date()));
    setFollowUpNotes('');
    setIsFollowUpOpen(true);
    setIsFabOpen(false);
  };

  const handleSubmitFollowUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoggingFollowUp) {
      return;
    }
    setIsLoggingFollowUp(true);
    try {
      const parsedDate = followUpWhen ? parseFollowUpWhen(followUpWhen.trim()) : null;
      const dateValue = parsedDate ? parsedDate.toISOString() : new Date().toISOString();
      const created = await firebaseLeadRepository.addActivity(lead.id, {
        type: followUpType,
        note: followUpNotes.trim() || 'Follow-up logged.',
        date: dateValue,
        createdBy: currentUserId ?? lead.ownerId,
      });
      setActivities((prev) => [created, ...prev]);
      if (user) {
        await emitNotificationEventSafe({
          type: 'lead.follow_up',
          title: 'Lead Follow-up Logged',
          body: `${user.fullName} logged a ${followUpType} on ${lead.name}.`,
          actorId: user.id,
          recipients: buildRecipientList(lead.ownerId, [], user.id),
          entityType: 'lead',
          entityId: lead.id,
          meta: {
            activityType: followUpType,
            when: dateValue,
          },
        });
      }
      setIsFollowUpOpen(false);
    } finally {
      setIsLoggingFollowUp(false);
    }
  };

  const handleConvert = async () => {
    if (isConverting || isConverted) {
      return;
    }
    setConversionError(null);
    setIsFabOpen(false);
    setIsConvertOpen(true);
  };

  const handleSubmitConvert = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isConverting || isConverted) {
      return;
    }
    setIsConverting(true);
    setConversionError(null);
    try {
      const existing =
        (await findCustomerByLeadId(lead.id)) ?? (await findCustomerByEmail(lead.email));
      if (existing) {
        setConvertedCustomerId(existing.id);
        setIsFabOpen(true);
        setIsConvertOpen(false);
        return;
      }
      const created = await firebaseCustomerRepository.create({
        companyName: convertForm.companyName.trim(),
        contactPerson: convertForm.contactPerson.trim(),
        email: convertForm.email.trim(),
        phone: convertForm.phone.trim(),
        source: convertForm.source.trim(),
        status: convertForm.status,
        assignedTo: convertForm.assignedTo || lead.ownerId,
        sharedRoles: [],
        createdBy: currentUserId ?? lead.ownerId,
        leadId: lead.id,
      });
      setConvertedCustomerId(created.id);
      setIsFabOpen(true);
      if (lead.status !== 'proposal') {
        await onUpdate(lead.id, { status: 'proposal' });
      }
      const logged = await firebaseLeadRepository.addActivity(lead.id, {
        type: 'note',
        note: 'Converted to customer.',
        date: new Date().toISOString(),
        createdBy: currentUserId ?? lead.ownerId,
      });
      setActivities((prev) => [logged, ...prev]);
      if (user) {
        await emitNotificationEventSafe({
          type: 'lead.converted',
          title: 'Lead Converted',
          body: `${user.fullName} converted ${lead.name} to a customer.`,
          actorId: user.id,
          recipients: buildRecipientList(lead.ownerId, [], user.id),
          entityType: 'lead',
          entityId: lead.id,
          meta: {
            customerId: created.id,
          },
        });
      }
      setIsConvertOpen(false);
    } catch {
      setConversionError('Unable to convert lead. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  const handleRequestQuotation = () => {
    if (!isConverted || isRequestingRfq || !canRequestRfq) {
      return;
    }
    setRfqError(null);
    setRfqPriority('medium');
    setRfqRecipients([]);
    setRfqNotes('');
    setRfqTags([]);
    setIsRfqModalOpen(true);
    setIsFabOpen(false);
  };

  const handleSubmitRfq = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isConverted || isRequestingRfq || !canRequestRfq) {
      return;
    }
    if (!convertedCustomerId) {
      setRfqError('Customer not found.');
      return;
    }
    if (rfqRecipients.length === 0) {
      setRfqError('Select at least one recipient.');
      return;
    }
    if (rfqTags.length === 0) {
      setRfqError('Select at least one task tag.');
      return;
    }
    setIsRequestingRfq(true);
    setRfqError(null);
    try {
      const recipients = rfqRecipients
        .map((id) => rfqRecipientsById.get(id))
        .filter((value): value is { id: string; name: string; roleKey: string } => Boolean(value));
      const created = await firebaseQuotationRequestRepository.create({
        leadId: lead.id,
        leadName: lead.name,
        leadCompany: lead.company,
        leadEmail: lead.email,
        customerId: convertedCustomerId,
        requestedBy: currentUserId ?? lead.ownerId,
        requestedByName: user?.fullName ?? ownerName,
        recipients,
        priority: rfqPriority,
        tags: rfqTags,
        notes: rfqNotes.trim(),
      });
      await firebaseQuotationRequestRepository.addTasks(
        created.id,
        rfqTags.map((tag) => ({ tag, status: 'pending' })),
      );
      const logged = await firebaseLeadRepository.addActivity(lead.id, {
        type: 'note',
        note: `RFQ requested by ${user?.fullName ?? ownerName}. Recipients: ${recipients
          .map((entry) => entry.name)
          .join(', ')}. Tasks: ${rfqTags.join(', ')}.`,
        date: new Date().toISOString(),
        createdBy: currentUserId ?? lead.ownerId,
      });
      setActivities((prev) => [logged, ...prev]);
      if (user) {
        const recipientIds = recipients.map((entry) => entry.id);
        const requesterId = currentUserId ?? lead.ownerId;
        await emitNotificationEventSafe({
          type: 'quotation_request.created',
          title: 'Quotation Request Created',
          body: `${user.fullName} requested a quote for ${lead.company}.`,
          actorId: user.id,
          recipients: buildRecipientList(requesterId, recipientIds, user.id),
          entityType: 'quotationRequest',
          entityId: created.id,
          meta: {
            leadId: lead.id,
            priority: rfqPriority,
            tags: rfqTags,
          },
        });
      }
      setIsRfqModalOpen(false);
      setIsFabOpen(false);
    } catch {
      setRfqError('Unable to create quotation request.');
    } finally {
      setIsRequestingRfq(false);
    }
  };

  const handleOpenTaskModal = () => {
    openTaskModal({
      leadId: lead.id,
      leadName: lead.name,
      ownerId: lead.ownerId,
    });
  };

  const rfqModal = (
    <Modal
      open={isRfqModalOpen}
      onClose={() => setIsRfqModalOpen(false)}
      ariaLabel="Quotation request"
      size="lg"
      portal
      overlayClassName="z-[60] backdrop-blur-sm"
    >
      <ModalHeader
        title="Quotation Request"
        description="Route this lead to the right quoting team and trigger task workflows."
        actions={
          <button
            type="button"
            onClick={() => setIsRfqModalOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-full border border-border/60 text-muted transition hover:bg-hover/80"
            aria-label="Close quotation request"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        }
        className="pb-[var(--modal-section-gap)] border-b border-border/60"
      />

      <form className="mt-[var(--modal-section-gap)] space-y-5" onSubmit={handleSubmitRfq}>
        <div className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-text">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Lead details
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-text">{lead.name}</span>
              <span className="text-xs text-muted">{lead.company}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{lead.email}</span>
              <span>Assigned to {ownerName}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Priority level
            <select
              value={rfqPriority}
              onChange={(event) => setRfqPriority(event.target.value as 'low' | 'medium' | 'high')}
              className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-black outline-none"
            >
              {RFQ_PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            Recipients
            <select
              value={rfqRecipientPick}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  return;
                }
                setRfqRecipients((prev) => (prev.includes(value) ? prev : [...prev, value]));
                setRfqRecipientPick('');
              }}
              className="mt-2 w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
            >
              <option value="">Select recipient</option>
              {rfqRecipientGroups.length === 0 ? (
                <option value="" disabled>
                  No eligible recipients available
                </option>
              ) : (
                rfqRecipientGroups.map((group) => (
                  <optgroup key={group.roleKey} label={group.roleName}>
                    {group.users.map((userItem) => (
                      <option key={userItem.id} value={userItem.id}>
                        {userItem.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            <div className="mt-3 flex flex-wrap gap-2">
              {rfqRecipients.length === 0 ? (
                <span className="text-[11px] text-muted">No recipients added.</span>
              ) : (
                rfqRecipients.map((recipientId) => {
                  const recipient = rfqRecipientsById.get(recipientId);
                  if (!recipient) {
                    return null;
                  }
                  return (
                    <button
                      key={recipientId}
                      type="button"
                      onClick={() =>
                        setRfqRecipients((prev) => prev.filter((id) => id !== recipientId))
                      }
                      className="flex items-center gap-2 rounded-full border border-border/60 bg-bg/70 px-3 py-1 text-xs text-text"
                    >
                      <span>{recipient.name}</span>
                      <span className="text-muted">x</span>
                    </button>
                  );
                })
              )}
            </div>
          </label>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Task tags</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {RFQ_TAGS.map((tag) => {
              const isSelected = rfqTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setRfqTags((prev) =>
                      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                    )
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    isSelected
                      ? 'border-accent/60 bg-accent/15 text-text'
                      : 'border-border/60 bg-bg/70 text-muted hover:text-text'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
          Notes
          <textarea
            value={rfqNotes}
            onChange={(event) => setRfqNotes(event.target.value)}
            placeholder="Any special instructions for quoting?"
            className="mt-2 min-h-[120px] w-full rounded-2xl border border-border/60 bg-bg/70 px-4 py-2 text-sm text-text outline-none"
          />
        </label>
        {rfqError ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {rfqError}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setIsRfqModalOpen(false)}
            className="text-sm font-semibold text-muted transition hover:text-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isRequestingRfq}
            className="rounded-full border border-border/60 bg-accent/80 px-6 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRequestingRfq ? 'Requesting...' : 'Send request'}
          </button>
        </div>
      </form>
    </Modal>
  );

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Lead details"
      size="lg"
      panelClassName="animate-fade-up"
    >
      <ModalHeader
        title={
          <div className="flex flex-wrap items-center gap-3">
            <ModalTitle>{lead.name}</ModalTitle>
            <StatusPill status={lead.status} />
          </div>
        }
        description={
          <div className="flex flex-wrap items-center gap-3 text-[var(--modal-body-size)] text-muted">
            <span className="text-text">{lead.company}</span>
            <span className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-900">
                {ownerName?.charAt(0)?.toUpperCase() ?? 'U'}
              </span>
              Assigned to: <span className="font-semibold text-text">{ownerName}</span>
            </span>
          </div>
        }
        actions={
          <>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className="rounded-full border border-border/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80"
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-full border border-border/60 text-muted transition hover:bg-hover/80"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        }
      />

      {isEditing ? (
        <div className="mt-6 rounded-2xl border border-border/60 bg-bg/70 p-4">
          <form onSubmit={handleSave}>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
              Edit lead
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-text">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Name
                <input
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Company
                <input
                  value={formState.company}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, company: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Email
                <input
                  type="email"
                  value={formState.email}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, email: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Phone
                <input
                  value={formState.phone}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Status
                <select
                  value={formState.status}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      status: event.target.value as LeadStatus,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                >
                  {[
                    { label: 'New', value: 'new' },
                    { label: 'Contacted', value: 'contacted' },
                    { label: 'Proposal', value: 'proposal' },
                    { label: 'Negotiation', value: 'negotiation' },
                    { label: 'Won', value: 'won' },
                    { label: 'Lost', value: 'lost' },
                  ].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Value
                <input
                  type="number"
                  value={formState.value}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, value: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                />
              </label>
              <label className="col-span-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                Source
                <select
                  value={formState.source || ''}
                  onChange={(event) => {
                    if (event.target.value === '__new__') {
                      setIsAddingSource(true);
                      setFormState((prev) => ({ ...prev, source: '' }));
                      return;
                    }
                    setIsAddingSource(false);
                    setFormState((prev) => ({ ...prev, source: event.target.value }));
                  }}
                  className="mt-2 w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                >
                  <option value="">Select source</option>
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                  {canManageSources ? <option value="__new__">Add new source...</option> : null}
                </select>
              </label>
              {canManageSources && isAddingSource ? (
                <div className="col-span-2 text-xs">
                  <label className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
                    New source
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={newSourceName}
                        onChange={(event) => setNewSourceName(event.target.value)}
                        placeholder="New source name"
                        className="w-full rounded-xl border border-border/60 bg-surface/80 px-3 py-2 text-sm text-text outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!onCreateSource) {
                            return;
                          }
                          const created = await onCreateSource(newSourceName);
                          if (created) {
                            setFormState((prev) => ({ ...prev, source: created }));
                            setIsAddingSource(false);
                            setNewSourceName('');
                          }
                        }}
                        className="rounded-full border border-border/60 bg-accent/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-text transition hover:bg-accent-strong/80"
                      >
                        Add
                      </button>
                    </div>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-full border border-border/60 bg-accent/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {canDelete ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="rounded-full border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-border/60 bg-bg/70 p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-text">Timeline</p>
              <button
                type="button"
                onClick={() => setIsTimelineOpen((prev) => !prev)}
                className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted transition hover:bg-hover/80 md:hidden"
              >
                {isTimelineOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            <div
              className={`mt-5 max-h-[360px] space-y-5 overflow-y-auto pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
                isTimelineOpen ? 'block' : 'hidden'
              } md:block`}
            >
              {isLoadingActivities ? (
                <p className="text-sm text-muted">Loading activity...</p>
              ) : activities.length === 0 ? (
                <p className="text-sm text-muted">No activity logged yet.</p>
              ) : (
                activities.map((activity, index) => (
                  <div key={`${activity.id}-${index}`} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className={`h-3 w-3 rounded-full ${activityDotClass(activity)}`} />
                      {index < activities.length - 1 ? (
                        <span className="mt-2 h-10 w-[1px] bg-border/60" />
                      ) : null}
                    </div>
                    <div>
                      <p className="font-semibold text-text">{activity.note}</p>
                      <p className="mt-1 text-sm text-muted">
                        {formatTimelineDate(activity.date)} -{' '}
                        {ownerNameMap?.[activity.createdBy] ?? activity.createdBy}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border/60 bg-bg/70 p-5">
              <p className="text-sm font-semibold text-text">Lead Details</p>
              <div className="mt-4 grid gap-3 text-sm text-muted">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Value</span>
                  <span className="font-semibold text-text">
                    {Number.isFinite(lead.value) ? formatCurrency(lead.value) : '-'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Source</span>
                  <span className="font-semibold text-text">{lead.source || '-'}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Created</span>
                  <span className="font-semibold text-text">
                    {formatTimelineDate(lead.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-bg/70 p-5">
              <p className="text-sm font-semibold text-text">Assignment</p>
              <div className="mt-4 grid gap-3 text-sm text-muted">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Assigned To</span>
                  <span className="flex items-center gap-2 font-semibold text-text">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-900">
                      {ownerName?.charAt(0)?.toUpperCase() ?? 'U'}
                    </span>
                    {ownerName}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Status</span>
                  <span className="font-semibold text-text">{formatStatusLabel(lead.status)}</span>
                </div>
              </div>
            </div>

            <div className="col-span-2 rounded-2xl border border-border/60 bg-bg/70 p-5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-border/60 bg-surface/80 text-muted">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="4" y="5" width="16" height="15" rx="2" />
                      <path d="M4 9h16M8 3.5v3M16 3.5v3" />
                    </svg>
                  </span>
                  <div>
                    <p className="font-semibold text-text">Add Task to Calendar</p>
                    <p className="mt-1 text-sm text-muted">
                      Schedule next steps directly from the lead record.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenTaskModal}
                  disabled={isTaskSubmitting}
                  className="rounded-full border border-border/60 bg-accent/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-text transition hover:-translate-y-[1px] hover:bg-accent-strong/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isTaskSubmitting ? 'Adding...' : 'Add Task to Calendar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isFollowUpOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={() => setIsFollowUpOpen(false)}
        >
          <DraggablePanel
            className="w-full max-w-xl overflow-hidden rounded-[28px] bg-white bg-clip-padding p-6 shadow-[0_20px_50px_rgba(15,23,42,0.2)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-semibold text-[#2f6b4f]">Log Follow-up</h3>
              <button
                type="button"
                onClick={() => setIsFollowUpOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-[#94a3b8] transition hover:bg-[#f1f5f9]"
                aria-label="Close follow-up"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4 h-px w-full bg-[#d1e7dc]" />

            <form className="mt-5 space-y-5" onSubmit={handleSubmitFollowUp}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Type
                  <select
                    value={followUpType}
                    onChange={(event) => setFollowUpType(event.target.value as LeadActivityType)}
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                  >
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                    <option value="meeting">Meeting</option>
                    <option value="task">Task</option>
                    <option value="note">Note</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  When
                  <div className="relative mt-2">
                    <input
                      type="text"
                      value={followUpWhen}
                      onChange={(event) => setFollowUpWhen(event.target.value)}
                      placeholder="22/01/2026 01:57 PM"
                      className="w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 pr-11 text-sm text-[#334155] outline-none placeholder:text-[#94a3b8]"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#94a3b8]">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" />
                      </svg>
                    </span>
                  </div>
                </label>
              </div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                Notes
                <textarea
                  value={followUpNotes}
                  onChange={(event) => setFollowUpNotes(event.target.value)}
                  placeholder="What happened? e.g. Email sent with proposal"
                  className="mt-2 min-h-[140px] w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none placeholder:text-[#94a3b8]"
                />
              </label>
              <div className="flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={() => setIsFollowUpOpen(false)}
                  className="text-sm font-semibold text-[#64748b] transition hover:text-[#334155]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoggingFollowUp}
                  className="rounded-2xl bg-[#8bc6a2] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#79b692] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoggingFollowUp ? 'Logging...' : 'Log Activity'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}
      {rfqModal}

      {conversionError ? (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
          {conversionError}
        </div>
      ) : null}

      {isConvertOpen ? (
        <div
          data-modal-overlay="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={() => setIsConvertOpen(false)}
        >
          <DraggablePanel
            className="w-full max-w-2xl overflow-hidden rounded-[28px] bg-white bg-clip-padding p-6 shadow-[0_20px_50px_rgba(15,23,42,0.2)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-2xl font-semibold text-[#2f6b4f]">Convert to Customer</h3>
              <button
                type="button"
                onClick={() => setIsConvertOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-[#94a3b8] transition hover:bg-[#f1f5f9]"
                aria-label="Close convert modal"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4 h-px w-full bg-[#d1e7dc]" />

            <form className="mt-5 space-y-4" onSubmit={handleSubmitConvert}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Company name
                  <input
                    value={convertForm.companyName}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, companyName: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Contact person
                  <input
                    value={convertForm.contactPerson}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, contactPerson: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Email
                  <input
                    type="email"
                    value={convertForm.email}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Phone
                  <input
                    value={convertForm.phone}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, phone: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Source
                  <input
                    value={convertForm.source}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, source: event.target.value }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Status
                  <select
                    value={convertForm.status}
                    onChange={(event) =>
                      setConvertForm((prev) => ({
                        ...prev,
                        status: event.target.value as CustomerStatus,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none"
                  >
                    {[
                      'active',
                      'inactive',
                      'new',
                      'contacted',
                      'proposal',
                      'negotiation',
                      'won',
                      'lost',
                    ].map((status) => (
                      <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#334155]">
                  Assigned to
                  <select
                    value={convertForm.assignedTo}
                    onChange={(event) =>
                      setConvertForm((prev) => ({ ...prev, assignedTo: event.target.value }))
                    }
                    disabled={!canAssignCustomers}
                    className="mt-2 w-full rounded-xl border border-[#dbe2ea] bg-[#f8fafc] px-4 py-3 text-sm text-[#334155] outline-none disabled:cursor-not-allowed disabled:text-muted"
                  >
                    {!canAssignCustomers ? (
                      <option value={lead.ownerId}>{ownerName}</option>
                    ) : customerAssignees.length === 0 ? (
                      <option value="" disabled>
                        No eligible assignees
                      </option>
                    ) : (
                      customerAssignees.map((assignee) => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.fullName}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <div className="flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={() => setIsConvertOpen(false)}
                  className="text-sm font-semibold text-[#64748b] transition hover:text-[#334155]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConverting}
                  className="rounded-2xl bg-[#8bc6a2] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#79b692] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isConverting ? 'Converting...' : 'Convert'}
                </button>
              </div>
            </form>
          </DraggablePanel>
        </div>
      ) : null}
      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center">
        {isFabOpen ? (
          <div className="mb-3 w-[320px] overflow-hidden rounded-3xl border border-[#e5eef6] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#eef2f7] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#1f2937]">Quick Actions</p>
                <p className="text-xs text-[#64748b]">Act instantly to move this lead forward</p>
              </div>
              <span className="rounded-full border border-[#bbf7d0] bg-[#dcfce7] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#166534]">
                Live
              </span>
            </div>
            <div className="grid gap-3 px-4 py-4">
              <button
                type="button"
                onClick={handleFollowUp}
                className="flex items-center gap-4 rounded-2xl border border-transparent px-2 py-2 text-left transition hover:bg-hover/30"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#dbe8ff] text-[#1d4ed8]">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </span>
                <span>
                  <p className="text-base font-semibold text-[#1d4ed8]">Log Follow-up</p>
                  <p className="text-sm text-[#3b82f6]">Capture your latest touchpoint</p>
                </span>
              </button>

              {isConverted ? (
                canRequestRfq ? (
                  <button
                    type="button"
                    onClick={handleRequestQuotation}
                    disabled={isRequestingRfq}
                    className="flex items-center gap-4 rounded-2xl border border-transparent px-2 py-2 text-left transition hover:bg-[#f2fbf6]"
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d1fae5] text-[#047857]">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </span>
                    <span>
                      <p className="text-base font-semibold text-[#047857]">
                        {isRequestingRfq ? 'Requesting...' : 'Request Quotation'}
                      </p>
                      <p className="text-sm text-[#10b981]">Create quote request</p>
                    </span>
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={isConverting}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-white px-4 py-3 text-left transition hover:bg-hover/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fde7d4] text-[#c2410c]">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    </span>
                    <span>
                      <p className="text-base font-semibold text-[#c2410c]">
                        {isConverting ? 'Converting...' : 'Convert to Customer'}
                      </p>
                      <p className="text-sm text-[#ea580c]">Create customer record</p>
                    </span>
                  </div>
                  <span className="text-lg text-[#c2410c]">→</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setIsFabOpen((prev) => !prev)}
          className="grid h-12 w-12 place-items-center rounded-full border border-border/60 bg-accent/90 text-text shadow-floating transition hover:-translate-y-[1px] hover:bg-accent-strong/90"
          aria-label="Open lead actions"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </Modal>
  );
}
