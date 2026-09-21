'use client';

import { Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PASSWORD_POLICY } from '@itam/shared';
import { FilterBar } from '@/components/filter-bar';
import { EmployeePicker, EnumSelect } from '@/components/pickers';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { Role, UserAccount } from '@/lib/types';

const DEFAULTS = { tab: 'users', search: '', status: '', page: '1' };

function UserDialog({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user?: UserAccount;
}) {
  const toast = useToast();
  const { can, user: me } = useAuth();
  const editing = !!user;
  const roles = useApi<Role[]>(open ? '/roles' : null);
  const mutation = useApiMutation<Record<string, unknown>>(
    editing ? 'patch' : 'post',
    editing ? `/users/${user.id}` : '/users',
    ['/users', '/employees'],
  );
  const [form, setForm] = useState({ email: '', displayName: '', password: '' });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm({ email: user?.email ?? '', displayName: user?.displayName ?? '', password: '' });
    setEmployeeId(user?.employee?.id ?? null);
    setRoleIds(user?.roles.map((r) => r.role.id) ?? []);
    setError(null);
    setFieldErrors({});
  }, [open, user]);

  const save = async () => {
    setError(null);
    setFieldErrors({});
    if (!roleIds.length) return setError('Choose at least one role');
    if ((!editing || form.password) && !PASSWORD_POLICY.pattern.test(form.password))
      return setFieldErrors({ password: PASSWORD_POLICY.description });
    try {
      await mutation.mutateAsync({
        email: form.email,
        displayName: form.displayName,
        password: form.password || undefined,
        employeeId: employeeId ?? (editing ? null : undefined),
        roleIds,
      });
      toast.success(editing ? 'User updated' : 'User created — share the password securely');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.code === 'CONFLICT' ? 'A user with this email already exists.' : e.message);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${user.displayName}` : 'Invite user'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={fieldErrors.displayName}>
            {(p) => (
              <Input
                {...p}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Email" required error={fieldErrors.email}>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={editing ? 'Set new password' : 'Initial password'}
            required={!editing}
            error={fieldErrors.password}
            hint={
              editing
                ? 'Leave empty to keep the current password. Setting one signs the user out everywhere.'
                : PASSWORD_POLICY.description
            }
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>
          <Field label="Linked employee" hint="Required for own-asset access and acknowledgements">
            {(p) => (
              <EmployeePicker
                id={p.id}
                value={employeeId}
                onChange={setEmployeeId}
                initialLabel={
                  user?.employee
                    ? `${user.employee.firstName} ${user.employee.lastName}`
                    : undefined
                }
                query={{ status: undefined }}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Roles
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(roles.data?.data ?? []).map((r) => {
              const locked = r.name === 'SUPER_ADMIN' && !can('role.manage');
              const self = editing && user.id === me?.id && r.name === 'SUPER_ADMIN';
              return (
                <label
                  key={r.id}
                  className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${roleIds.includes(r.id) ? 'border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'} ${locked ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    disabled={locked || self}
                    checked={roleIds.includes(r.id)}
                    onChange={(e) =>
                      setRoleIds((ids) =>
                        e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id),
                      )
                    }
                  />
                  <span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {r.displayName}
                    </span>
                    {r.description && (
                      <span className="block text-xs text-slate-500">{r.description}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<Role[]>('/roles');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', displayName: '', description: '' });
  const create = useApiMutation<Record<string, unknown>, Role>('post', '/roles', ['/roles']);

  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (r) => (
        <div>
          <Link
            href={`/users/roles/${r.id}`}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {r.displayName}
          </Link>
          <p className="text-xs text-slate-500">{r.description ?? r.name}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (r) => (r.isSystem ? <Badge tone="blue">System</Badge> : <Badge>Custom</Badge>),
    },
    { key: 'users', header: 'Users', cell: (r) => r._count.users },
    { key: 'perms', header: 'Permissions', cell: (r) => r._count.permissions ?? '—' },
  ];

  return (
    <>
      {can('role.manage') && (
        <div className="flex justify-end border-b border-slate-100 p-4 dark:border-slate-800">
          <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
            New role
          </Button>
        </div>
      )}
      <DataTable
        caption="Roles"
        columns={columns}
        rows={query.data?.data}
        loading={query.isFetching}
        error={query.error}
      />
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New custom role"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              onClick={async () => {
                try {
                  const { data } = await create.mutateAsync(form);
                  toast.success('Role created — now choose its permissions');
                  setCreating(false);
                  window.location.assign(`/users/roles/${data.id}`);
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Display name" required>
            {(p) => (
              <Input
                {...p}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Key" required hint="UPPER_SNAKE_CASE, e.g. HELPDESK_AGENT">
            {(p) => (
              <Input
                {...p}
                className="uppercase"
                value={form.name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                  })
                }
              />
            )}
          </Field>
          <Field label="Description">
            {(p) => (
              <Input
                {...p}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </>
  );
}

export default function UsersPage() {
  const { can, user: me } = useAuth();
  const toast = useToast();
  const { params, set } = useListParams(DEFAULTS);
  const [dialog, setDialog] = useState<UserAccount | 'new' | null>(null);
  const tab = can('user.view') ? params.tab : 'roles';
  const query = useApi<UserAccount[]>(tab === 'users' ? '/users' : null, {
    search: params.search,
    status: params.status,
    page: params.page,
    limit: 25,
  });

  const toggle = async (u: UserAccount) => {
    try {
      await api.post(`/users/${u.id}/${u.status === 'ACTIVE' ? 'disable' : 'enable'}`);
      toast.success(
        u.status === 'ACTIVE'
          ? `${u.displayName} disabled and signed out`
          : `${u.displayName} enabled`,
      );
      void query.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<UserAccount>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (u) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{u.displayName}</p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => (
            <Badge key={r.role.id} tone={r.role.name === 'SUPER_ADMIN' ? 'violet' : 'gray'}>
              {r.role.displayName}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (u) => (u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : '—'),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) =>
        u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
          <Badge tone="red">Locked</Badge>
        ) : (
          <StatusBadge group="userStatus" value={u.status} />
        ),
    },
    {
      key: 'login',
      header: 'Last sign-in',
      cell: (u) => formatRelative(u.lastLoginAt),
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (u) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can('user.edit') && (
            <Button variant="ghost" size="sm" onClick={() => setDialog(u)}>
              Edit
            </Button>
          )}
          {can('user.disable') && u.id !== me?.id && (
            <Button variant="ghost" size="sm" onClick={() => toggle(u)}>
              {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Accounts, role membership and granular permissions. Access is enforced by the API on every request."
        actions={
          tab === 'users' &&
          can('user.create') && (
            <Button onClick={() => setDialog('new')} icon={<Plus className="h-4 w-4" />}>
              Invite user
            </Button>
          )
        }
      />
      <Card>
        <div className="px-4 pt-3">
          <Tabs
            value={tab}
            onChange={(t) => set({ tab: t })}
            tabs={[
              { value: 'users', label: 'Users', hidden: !can('user.view') },
              { value: 'roles', label: 'Roles & permissions', hidden: !can('role.view') },
            ]}
          />
        </div>
        {tab === 'users' ? (
          <>
            <FilterBar
              search={params.search}
              onSearch={(search) => set({ search })}
              placeholder="Name or email…"
            >
              <EnumSelect
                group="userStatus"
                placeholder="Any status"
                value={params.status}
                onChange={(e) => set({ status: e.target.value })}
                aria-label="Status"
              />
            </FilterBar>
            <DataTable
              caption="Users"
              columns={columns}
              rows={query.data?.data}
              loading={query.isFetching}
              error={query.error}
              meta={query.data?.meta}
              onPage={(page) => set({ page: String(page) })}
              empty={<EmptyState title="No users" icon={<ShieldCheck className="h-6 w-6" />} />}
            />
          </>
        ) : (
          <RolesTab />
        )}
      </Card>
      <UserDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        user={dialog && dialog !== 'new' ? dialog : undefined}
      />
    </>
  );
}
