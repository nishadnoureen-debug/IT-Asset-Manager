'use client';

import clsx from 'clsx';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { LABELS } from '@itam/shared';
import type { PaginationMeta } from '@itam/shared';
import { useApi, useDebounced } from '@/lib/hooks';
import type { AssetType, Department, Location, Vendor } from '@/lib/types';
import { Select } from './ui/form';

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string };

/** <select> of enum values with human labels. */
export const EnumSelect = forwardRef<
  HTMLSelectElement,
  SelectProps & { group: keyof typeof LABELS; exclude?: string[] }
>(function EnumSelect({ group, exclude = [], placeholder, ...props }, ref) {
  const entries = Object.entries(LABELS[group] as Record<string, string>).filter(
    ([v]) => !exclude.includes(v),
  );
  return (
    <Select ref={ref} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {entries.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </Select>
  );
});

function makeRefSelect<T extends { id: string }>(path: string, labelOf: (item: T) => string) {
  return forwardRef<HTMLSelectElement, SelectProps>(function RefSelect(
    { placeholder = 'Select…', ...props },
    ref,
  ) {
    const { data, isLoading } = useApi<T[] | { data: T[] }>(path, undefined, { staleTime: 60_000 });
    const items = (Array.isArray(data?.data) ? data?.data : []) as T[];
    return (
      <Select ref={ref} {...props} disabled={props.disabled || isLoading}>
        <option value="">{isLoading ? 'Loading…' : placeholder}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {labelOf(item)}
          </option>
        ))}
      </Select>
    );
  });
}

export const DepartmentSelect = makeRefSelect<Department>('/departments', (d) => d.name);
export const LocationSelect = makeRefSelect<Location>('/locations', (l) =>
  l.parent ? `${l.parent.name} › ${l.name}` : l.name,
);
export const AssetTypeSelect = makeRefSelect<AssetType>('/asset-types', (t) => t.name);

/** Vendors are paginated; fetch a generous page for dropdowns. */
export const VendorSelect = forwardRef<HTMLSelectElement, SelectProps>(function VendorSelect(
  { placeholder = 'Select…', ...props },
  ref,
) {
  const { data, isLoading } = useApi<Vendor[]>(
    '/vendors',
    { limit: 100, activeOnly: true },
    { staleTime: 60_000 },
  );
  return (
    <Select ref={ref} {...props} disabled={props.disabled || isLoading}>
      <option value="">{isLoading ? 'Loading…' : placeholder}</option>
      {(data?.data ?? []).map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </Select>
  );
});

export interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * Searchable combobox backed by a paginated list endpoint (employees, assets, users…).
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function SearchSelect<T extends { id: string }>({
  endpoint,
  query,
  toOption,
  value,
  onChange,
  placeholder = 'Search…',
  initialLabel,
  id,
  invalid,
  disabled,
}: {
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  toOption: (item: T) => Option;
  value: string | null | undefined;
  onChange: (id: string | null, option?: Option) => void;
  placeholder?: string;
  initialLabel?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? '');
  const [active, setActive] = useState(0);
  const search = useDebounced(text, 250);
  const ref = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useApi<T[]>(open ? endpoint : null, { ...query, search, limit: 20 });
  const options = (data?.data ?? []).map(toOption);
  const meta = data?.meta as PaginationMeta | undefined;

  useEffect(() => {
    if (initialLabel) setSelectedLabel(initialLabel);
  }, [initialLabel]);

  useEffect(() => {
    if (!value) setSelectedLabel('');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (option: Option) => {
    onChange(option.id, option);
    setSelectedLabel(option.label);
    setText('');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid}
          disabled={disabled}
          autoComplete="off"
          value={open ? text : selectedLabel}
          placeholder={selectedLabel || placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className={clsx(
            'block h-10 w-full rounded-lg border border-slate-300 bg-white pl-3 pr-16 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
            invalid && 'border-red-500',
          )}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-slate-400">
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear selection"
              className="rounded p-1 hover:text-slate-600"
              onClick={() => {
                onChange(null);
                setSelectedLabel('');
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <ChevronsUpDown className="h-4 w-4" aria-hidden />
        </div>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {isFetching && !options.length && (
            <li className="px-3 py-2 text-slate-500">Searching…</li>
          )}
          {!isFetching && !options.length && (
            <li className="px-3 py-2 text-slate-500">No matches</li>
          )}
          {options.map((option, i) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(i)}
              className={clsx(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2',
                i === active && 'bg-slate-100 dark:bg-slate-800',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-slate-900 dark:text-slate-100">
                  {option.label}
                </span>
                {option.sublabel && (
                  <span className="block truncate text-xs text-slate-500">{option.sublabel}</span>
                )}
              </span>
              {option.id === value && <Check className="h-4 w-4 text-blue-600" aria-hidden />}
            </li>
          ))}
          {meta && meta.total > options.length && (
            <li className="px-3 py-1.5 text-xs text-slate-400">
              Showing {options.length} of {meta.total} — keep typing to narrow down
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  department: { name: string } | null;
  status: string;
}

export function EmployeePicker(
  props: Omit<Parameters<typeof SearchSelect<EmployeeRow>>[0], 'endpoint' | 'toOption'>,
) {
  return (
    <SearchSelect<EmployeeRow>
      endpoint="/employees"
      query={{ status: 'ACTIVE', ...props.query }}
      placeholder="Search employees…"
      toOption={(e) => ({
        id: e.id,
        label: `${e.firstName} ${e.lastName}`,
        sublabel: [e.employeeNumber, e.department?.name].filter(Boolean).join(' · '),
      })}
      {...props}
    />
  );
}

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  status: string;
}

export function AssetPicker(
  props: Omit<Parameters<typeof SearchSelect<AssetRow>>[0], 'endpoint' | 'toOption'>,
) {
  return (
    <SearchSelect<AssetRow>
      endpoint="/assets"
      placeholder="Search by tag, name or serial…"
      toOption={(a) => ({
        id: a.id,
        label: `${a.assetTag} — ${a.name}`,
        sublabel: [a.serialNumber, LABELS.assetStatus[a.status as keyof typeof LABELS.assetStatus]]
          .filter(Boolean)
          .join(' · '),
      })}
      {...props}
    />
  );
}

/** Staff users (technicians/admins) for assignee pickers — small list, plain select. */
export const StaffSelect = forwardRef<HTMLSelectElement, SelectProps>(function StaffSelect(
  { placeholder = 'Unassigned', ...props },
  ref,
) {
  const { data, isLoading } = useApi<{ id: string; displayName: string; email: string }[]>(
    '/users/staff',
    undefined,
    { staleTime: 60_000 },
  );
  return (
    <Select ref={ref} {...props} disabled={props.disabled || isLoading}>
      <option value="">{isLoading ? 'Loading…' : placeholder}</option>
      {(data?.data ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </Select>
  );
});
