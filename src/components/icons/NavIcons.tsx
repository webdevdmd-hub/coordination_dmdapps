type IconProps = {
  className?: string;
};

export type NavIconName =
  | 'dashboard'
  | 'users'
  | 'roles'
  | 'crm'
  | 'leads'
  | 'calendar'
  | 'reports'
  | 'tasks'
  | 'sales'
  | 'customers'
  | 'projects'
  | 'quotationRequests'
  | 'quotations'
  | 'invoices'
  | 'salesOrder'
  | 'store'
  | 'procurement'
  | 'logistics'
  | 'marketing'
  | 'fleet'
  | 'compliance'
  | 'settings'
  | 'logout';

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const icons: Record<NavIconName, (props: IconProps) => React.ReactElement> = {
  dashboard: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="3" y="3.5" width="8" height="8" rx="2" />
      <rect x="13" y="3.5" width="8" height="5" rx="2" />
      <rect x="13" y="10.5" width="8" height="10.5" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </svg>
  ),
  users: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3.5 19.5c1.4-3 4.1-4.5 7.5-4.5" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M14.5 19.5c.7-2 2.3-3.2 4.5-3.6" />
    </svg>
  ),
  roles: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M12 3.5l7 3v5.2c0 4.4-2.9 7.2-7 8.8-4.1-1.6-7-4.4-7-8.8V6.5l7-3z" />
      <path d="M9.2 12.4l2 2.1 3.6-3.8" />
    </svg>
  ),
  crm: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2" />
    </svg>
  ),
  leads: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 5.5h16l-6 7v5l-4 2v-7l-6-7z" />
    </svg>
  ),
  calendar: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9h16M8 3.5v3M16 3.5v3" />
      <path d="M8.5 13.5h3M8.5 16.5h5" />
    </svg>
  ),
  reports: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M5 19.5v-6M11 19.5v-9M17 19.5v-12" />
      <path d="M4 19.5h16" />
    </svg>
  ),
  tasks: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <rect x="4" y="4.5" width="15" height="15" rx="2" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  ),
  sales: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 16l6-6 4 4 6-7" />
      <path d="M14 7h6v6" />
    </svg>
  ),
  customers: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="11" cy="9" r="3.5" />
      <path d="M4.5 19.5c1.6-3.3 4.4-5 8.2-5" />
      <path d="M17.5 8.5l.8 1.6 1.8.2-1.3 1.2.4 1.8-1.7-.9-1.6.9.3-1.8-1.2-1.2 1.7-.2.8-1.6z" />
    </svg>
  ),
  projects: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 8h7l2 2h7v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 8V6.5a2 2 0 0 1 2-2h5l2 2h3" />
    </svg>
  ),
  quotationRequests: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M7 4.5h7l4 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M14 4.5v4h4" />
      <path d="M10.5 13a2.5 2.5 0 1 1 3.5 2.3c-.9.3-1.5 1-1.5 1.8v.4" />
      <path d="M12 19h.01" />
    </svg>
  ),
  quotations: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M7 4.5h7l4 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M14 4.5v4h4" />
      <path d="M9.5 14.5l2 2 4-4" />
    </svg>
  ),
  invoices: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M7 4.5h10l2 2v13l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2v-12a2 2 0 0 1 2-2z" />
      <path d="M9.5 10.5h6M9.5 13.5h4" />
      <path d="M14.5 16.5h.01" />
    </svg>
  ),
  salesOrder: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 8h16a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 8V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v1" />
      <path d="M16.5 13.5h3" />
    </svg>
  ),
  store: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 10l2-5h12l2 5" />
      <path d="M5 10v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10" />
      <path d="M9 20.5v-6h6v6" />
    </svg>
  ),
  procurement: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <path d="M4 5h2l2 10h10.5l2-7H7.5" />
    </svg>
  ),
  logistics: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M3.5 16.5V8.5a2 2 0 0 1 2-2h8v10H3.5z" />
      <path d="M13.5 10.5h4l2.5 3v2h-6.5" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </svg>
  ),
  marketing: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 10.5l10-4v11l-10-4z" />
      <path d="M14 7l4-2.5v15L14 17" />
      <path d="M6.5 15.5l1.3 3.5" />
    </svg>
  ),
  fleet: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M4 15.5V12l2-4h10l2 4v3.5" />
      <path d="M6.5 15.5h11" />
      <circle cx="7.5" cy="16.5" r="1.5" />
      <circle cx="16.5" cy="16.5" r="1.5" />
    </svg>
  ),
  compliance: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M12 4.5v14.5" />
      <path d="M6 8.5h12" />
      <path d="M7 8.5l-3 4.5a3 3 0 0 0 5.5 2.5" />
      <path d="M17 8.5l3 4.5a3 3 0 0 1-5.5 2.5" />
    </svg>
  ),
  settings: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4.5 12a7.5 7.5 0 0 1 .4-2.3l2.3-.5.8-2.2-1.5-1.8A8 8 0 0 1 9.6 3.9l1.4 1.9 2.4-.1 1.2-2a8 8 0 0 1 3.6 2l-1 2.2 1.5 1.9 2.2.4a7.5 7.5 0 0 1 0 4.6l-2.3.5-.8 2.2 1.5 1.8a8 8 0 0 1-3.1 2.1l-1.4-1.9-2.4.1-1.2 2a8 8 0 0 1-3.6-2l1-2.2-1.5-1.9-2.2-.4A7.5 7.5 0 0 1 4.5 12z" />
    </svg>
  ),
  logout: ({ className }) => (
    <svg {...baseProps} className={className} aria-hidden="true">
      <path d="M10 5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H10" />
      <path d="M14 16l4-4-4-4" />
      <path d="M7 12h11" />
    </svg>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon className={className} />;
}
