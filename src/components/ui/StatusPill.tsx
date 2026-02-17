import { LeadStatus } from '@/core/entities/lead';

type StatusPillProps = {
  status: LeadStatus;
};

const statusStyles: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-indigo-100 text-indigo-700',
  proposal: 'bg-amber-100 text-amber-700',
  negotiation: 'bg-orange-100 text-orange-700',
  won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-rose-100 text-rose-700',
};

const formatStatus = (status: LeadStatus) =>
  status.replace(/\b\w/g, (value) => value.toUpperCase());

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${statusStyles[status]}`}
    >
      {formatStatus(status)}
    </span>
  );
}
