import clsx from 'clsx';
import { label, type LabelGroup } from '@itam/shared';

export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal';

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300',
  green:
    'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300',
  teal: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300',
};

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const TONE_MAP: Partial<Record<LabelGroup, Record<string, Tone>>> = {
  assetStatus: {
    PURCHASED: 'gray',
    REGISTERED: 'gray',
    IN_STOCK: 'blue',
    AVAILABLE: 'teal',
    ASSIGNED: 'green',
    IN_REPAIR: 'amber',
    LOST: 'red',
    RETIRED: 'violet',
    DISPOSED: 'gray',
  },
  assetCondition: { NEW: 'green', GOOD: 'teal', FAIR: 'amber', POOR: 'amber', DAMAGED: 'red' },
  assignmentStatus: { ACTIVE: 'green', RETURNED: 'gray', TRANSFERRED: 'blue' },
  maintenanceStatus: {
    SCHEDULED: 'blue',
    IN_PROGRESS: 'amber',
    COMPLETED: 'green',
    CANCELLED: 'gray',
  },
  priority: { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', CRITICAL: 'red' },
  ticketStatus: {
    OPEN: 'blue',
    IN_PROGRESS: 'amber',
    ON_HOLD: 'violet',
    RESOLVED: 'green',
    CLOSED: 'gray',
  },
  auditStatus: {
    DRAFT: 'gray',
    IN_PROGRESS: 'amber',
    IN_REVIEW: 'blue',
    CLOSED: 'green',
    CANCELLED: 'gray',
  },
  auditResult: {
    PENDING: 'gray',
    FOUND: 'green',
    MISSING: 'red',
    UNEXPECTED: 'amber',
    WRONG_LOCATION: 'amber',
    DAMAGED: 'red',
  },
  employeeStatus: { ACTIVE: 'green', ON_LEAVE: 'amber', TERMINATED: 'gray' },
  userStatus: { ACTIVE: 'green', DISABLED: 'gray', LOCKED: 'red' },
};

/** Badge for any enum value with consistent colours across the app. */
export function StatusBadge({
  group,
  value,
}: {
  group: LabelGroup;
  value: string | null | undefined;
}) {
  if (!value) return <span className="text-slate-400">—</span>;
  return <Badge tone={TONE_MAP[group]?.[value] ?? 'gray'}>{label(group, value)}</Badge>;
}
