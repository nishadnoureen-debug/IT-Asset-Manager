'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { DepartmentSelect, EnumSelect, LocationSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/states';
import { EmployeeDialog } from '@/features/employees/employee-dialog';
import { useAuth } from '@/lib/auth';
import { useApi, useListParams } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

const DEFAULTS = {
  search: '',
  departmentId: '',
  locationId: '',
  status: '',
  sortBy: 'name',
  sortOrder: 'asc',
  page: '1',
};

export default function EmployeesPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useApi<Employee[]>('/employees', { ...params, limit: 25 });

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Name',
      sort: 'name',
      cell: (e) => (
        <div>
          <Link
            href={`/employees/${e.id}`}
            onClick={(ev) => ev.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {e.firstName} {e.lastName}
          </Link>
          <p className="text-xs text-slate-500">{e.jobTitle ?? e.email}</p>
        </div>
      ),
    },
    {
      key: 'number',
      header: 'Emp. no.',
      sort: 'employeeNumber',
      cell: (e) => <span className="font-mono text-xs">{e.employeeNumber}</span>,
    },
    { key: 'department', header: 'Department', cell: (e) => e.department?.name ?? '—' },
    {
      key: 'location',
      header: 'Location',
      cell: (e) => e.location?.name ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'assets',
      header: 'Assets',
      cell: (e) => <span className="tabular-nums">{e._count.assignments}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => <StatusBadge group="employeeStatus" value={e.status} />,
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Employees"
        description="People who can hold company assets."
        actions={
          can('employee.create') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              Add employee
            </Button>
          )
        }
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Name, email, number…"
          showReset={!!(params.search || params.departmentId || params.locationId || params.status)}
          onReset={() => set({ search: '', departmentId: '', locationId: '', status: '' })}
        >
          <DepartmentSelect
            placeholder="All departments"
            value={params.departmentId}
            onChange={(e) => set({ departmentId: e.target.value })}
            aria-label="Department"
          />
          <LocationSelect
            placeholder="All locations"
            value={params.locationId}
            onChange={(e) => set({ locationId: e.target.value })}
            aria-label="Location"
          />
          <EnumSelect
            group="employeeStatus"
            placeholder="Any status"
            value={params.status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Status"
          />
        </FilterBar>
        <DataTable
          caption="Employees"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(e) => router.push(`/employees/${e.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={<EmptyState title="No employees found" />}
        />
      </Card>
      <EmployeeDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
