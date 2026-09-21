'use client';

import { BellRing, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { AppSettings } from '@itam/shared';
import { EmployeePicker, EnumSelect, LocationSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { AssetType, Department, Location } from '@/lib/types';

type Tab = 'general' | 'departments' | 'locations' | 'types';

interface SettingsForm {
  companyName: string;
  defaultCurrency: string;
  assetTagPrefix: string;
  warrantyAlertDays: string;
  licenseAlertDays: string;
  maintenanceDueDays: string;
  allowSelfRegistration: boolean;
  registrationRequiresApproval: boolean;
}

function GeneralSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<AppSettings>('/settings', undefined, { placeholderData: undefined });
  const save = useApiMutation<Partial<AppSettings>>('patch', '/settings', ['/settings']);
  const [running, setRunning] = useState(false);
  const editable = can('settings.edit');
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
    watch,
  } = useForm<SettingsForm>();

  useEffect(() => {
    if (!query.data) return;
    const d = query.data.data;
    reset({
      companyName: d.companyName,
      defaultCurrency: d.defaultCurrency,
      assetTagPrefix: d.assetTagPrefix,
      warrantyAlertDays: String(d.warrantyAlertDays),
      licenseAlertDays: String(d.licenseAlertDays),
      maintenanceDueDays: String(d.maintenanceDueDays),
      allowSelfRegistration: d.allowSelfRegistration,
      registrationRequiresApproval: d.registrationRequiresApproval,
    });
  }, [query.data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        companyName: v.companyName,
        defaultCurrency: v.defaultCurrency.toUpperCase(),
        assetTagPrefix: v.assetTagPrefix.toUpperCase(),
        warrantyAlertDays: Number(v.warrantyAlertDays),
        licenseAlertDays: Number(v.licenseAlertDays),
        maintenanceDueDays: Number(v.maintenanceDueDays),
        allowSelfRegistration: v.allowSelfRegistration,
        registrationRequiresApproval: v.registrationRequiresApproval,
      });
      toast.success('Settings saved');
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors))
          setError(f as keyof SettingsForm, { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Organisation"
          description={editable ? undefined : 'Only Super Admins can change these settings.'}
        />
        <CardBody>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <FormError message={errors.root?.message} />
            <fieldset disabled={!editable} className="space-y-4">
              <FormGrid>
                <Field label="Company name" error={errors.companyName?.message}>
                  {(p) => <Input {...p} {...register('companyName', { required: 'Required' })} />}
                </Field>
                <Field
                  label="Default currency"
                  error={errors.defaultCurrency?.message}
                  hint="ISO code, e.g. USD or AED — used when a record has none"
                >
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={3}
                      className="uppercase"
                      {...register('defaultCurrency', {
                        pattern: { value: /^[A-Za-z]{3}$/, message: '3 letters' },
                      })}
                    />
                  )}
                </Field>
                <Field
                  label="Asset tag prefix"
                  error={errors.assetTagPrefix?.message}
                  hint="New tags look like PREFIX-000123"
                >
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={10}
                      className="uppercase"
                      {...register('assetTagPrefix', {
                        pattern: {
                          value: /^[A-Za-z0-9]{1,10}$/,
                          message: 'Letters and digits only',
                        },
                      })}
                    />
                  )}
                </Field>
              </FormGrid>
              <FormGrid className="sm:grid-cols-3">
                <Field
                  label="Warranty alerts (days before)"
                  error={errors.warrantyAlertDays?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      max={365}
                      {...register('warrantyAlertDays')}
                    />
                  )}
                </Field>
                <Field
                  label="Licence alerts (days before)"
                  error={errors.licenseAlertDays?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      max={365}
                      {...register('licenseAlertDays')}
                    />
                  )}
                </Field>
                <Field
                  label="Maintenance reminders (days before)"
                  error={errors.maintenanceDueDays?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      max={60}
                      {...register('maintenanceDueDays')}
                    />
                  )}
                </Field>
              </FormGrid>
              <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div>
                  <Checkbox
                    label="Allow people to create an account from the sign-in page"
                    {...register('allowSelfRegistration')}
                  />
                  <p className="mt-1 pl-6 text-xs text-slate-500">
                    New accounts get the Employee role. Change roles or link an employee record on
                    the Users screen.
                  </p>
                </div>
                <div>
                  <Checkbox
                    label="Require administrator approval for new accounts"
                    disabled={!watch('allowSelfRegistration')}
                    {...register('registrationRequiresApproval')}
                  />
                  <p className="mt-1 pl-6 text-xs text-slate-500">
                    When on, new accounts cannot sign in until an administrator approves them and
                    chooses their roles.
                  </p>
                </div>
              </div>
            </fieldset>
            {editable && (
              <div className="flex justify-end">
                <Button type="submit" disabled={!isDirty} loading={save.isPending}>
                  Save settings
                </Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Alerts"
          description="Expiry and overdue checks run every day at 07:00 and when the server starts."
        />
        <CardBody>
          <Button
            variant="secondary"
            loading={running}
            icon={<BellRing className="h-4 w-4" />}
            onClick={async () => {
              setRunning(true);
              try {
                const { data } = await api.post<Record<string, number>>(
                  '/notifications/run-checks',
                );
                const total = Object.values(data).reduce((a, b) => a + b, 0);
                toast.success(
                  total
                    ? `${total} new notifications sent`
                    : 'No new alerts — everything was already notified',
                );
              } catch (e) {
                toast.error(e);
              } finally {
                setRunning(false);
              }
            }}
          >
            Run checks now
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function RefDialog({
  kind,
  item,
  onClose,
}: {
  kind: 'department' | 'location' | 'type';
  item?: Department | Location | AssetType;
  onClose: () => void;
}) {
  const toast = useToast();
  const path = { department: '/departments', location: '/locations', type: '/asset-types' }[kind];
  const mutation = useApiMutation<Record<string, unknown>>(
    item ? 'patch' : 'post',
    item ? `${path}/${item.id}` : path,
    [path],
  );
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [managerId, setManagerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const i = item as Record<string, unknown> | undefined;
    if (kind === 'department') {
      setForm({
        code: String(i?.code ?? ''),
        name: String(i?.name ?? ''),
        description: String(i?.description ?? ''),
      });
      setManagerId((i?.managerId as string) ?? null);
    } else if (kind === 'location') {
      setForm({
        code: String(i?.code ?? ''),
        name: String(i?.name ?? ''),
        type: String(i?.type ?? 'SITE'),
        parentId: String(i?.parentId ?? ''),
        city: String(i?.city ?? ''),
        country: String(i?.country ?? ''),
        address: String(i?.address ?? ''),
      });
    } else {
      setForm({
        name: String(i?.name ?? ''),
        category: String(i?.category ?? 'LAPTOP'),
        depreciationMonths: i?.depreciationMonths ? String(i.depreciationMonths) : '',
        requiresSerial: i ? Boolean(i.requiresSerial) : true,
        isActive: i ? Boolean(i.isActive) : true,
      });
    }
  }, [kind, item]);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError(null);
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== ''),
    );
    if (kind === 'department') body.managerId = managerId ?? undefined;
    if (body.depreciationMonths) body.depreciationMonths = Number(body.depreciationMonths);
    try {
      await mutation.mutateAsync(body);
      toast.success('Saved');
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.code === 'CONFLICT'
            ? 'This code or name is already used.'
            : e.message
          : 'Save failed',
      );
    }
  };

  const title = `${item ? 'Edit' : 'Add'} ${kind === 'type' ? 'asset type' : kind}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
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
        {kind !== 'type' && (
          <FormGrid>
            <Field label="Code" required>
              {(p) => (
                <Input
                  {...p}
                  className="uppercase"
                  value={String(form.code ?? '')}
                  onChange={(e) => set('code', e.target.value)}
                />
              )}
            </Field>
            <Field label="Name" required>
              {(p) => (
                <Input
                  {...p}
                  value={String(form.name ?? '')}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>
          </FormGrid>
        )}
        {kind === 'department' && (
          <>
            <Field label="Manager">
              {(p) => <EmployeePicker id={p.id} value={managerId} onChange={setManagerId} />}
            </Field>
            <Field label="Description">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={String(form.description ?? '')}
                  onChange={(e) => set('description', e.target.value)}
                />
              )}
            </Field>
          </>
        )}
        {kind === 'location' && (
          <FormGrid>
            <Field label="Type">
              {(p) => (
                <EnumSelect
                  {...p}
                  group="locationType"
                  value={String(form.type ?? 'SITE')}
                  onChange={(e) => set('type', e.target.value)}
                />
              )}
            </Field>
            <Field label="Inside">
              {(p) => (
                <LocationSelect
                  {...p}
                  placeholder="Top level"
                  value={String(form.parentId ?? '')}
                  onChange={(e) => set('parentId', e.target.value)}
                />
              )}
            </Field>
            <Field label="City">
              {(p) => (
                <Input
                  {...p}
                  value={String(form.city ?? '')}
                  onChange={(e) => set('city', e.target.value)}
                />
              )}
            </Field>
            <Field label="Country">
              {(p) => (
                <Input
                  {...p}
                  value={String(form.country ?? '')}
                  onChange={(e) => set('country', e.target.value)}
                />
              )}
            </Field>
          </FormGrid>
        )}
        {kind === 'type' && (
          <>
            <FormGrid>
              <Field label="Name" required>
                {(p) => (
                  <Input
                    {...p}
                    value={String(form.name ?? '')}
                    onChange={(e) => set('name', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Category">
                {(p) => (
                  <EnumSelect
                    {...p}
                    group="assetCategory"
                    value={String(form.category ?? 'LAPTOP')}
                    onChange={(e) => set('category', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Depreciation (months)">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    value={String(form.depreciationMonths ?? '')}
                    onChange={(e) => set('depreciationMonths', e.target.value)}
                  />
                )}
              </Field>
            </FormGrid>
            <div className="flex gap-6">
              <Checkbox
                label="Serial number expected"
                checked={!!form.requiresSerial}
                onChange={(e) => set('requiresSerial', e.target.checked)}
              />
              <Checkbox
                label="Active"
                checked={!!form.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function RefList<T extends { id: string }>({
  kind,
  path,
  columns,
  canManage,
}: {
  kind: 'department' | 'location' | 'type';
  path: string;
  columns: Column<T>[];
  canManage: boolean;
}) {
  const toast = useToast();
  const query = useApi<T[]>(path);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const del = async () => {
    if (!deleting) return;
    try {
      await api.delete(`${path}/${deleting.id}`);
      toast.success('Deleted');
      void query.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setDeleting(null);
    }
  };
  const cols: Column<T>[] = [
    ...columns,
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (row: T) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                {kind !== 'type' && (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
                    Delete
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card>
      {canManage && (
        <div className="flex justify-end border-b border-slate-100 p-4 dark:border-slate-800">
          <Button onClick={() => setEditing('new')} icon={<Plus className="h-4 w-4" />}>
            Add
          </Button>
        </div>
      )}
      <DataTable
        columns={cols}
        rows={query.data?.data}
        loading={query.isFetching}
        error={query.error}
      />
      {editing && (
        <RefDialog
          kind={kind}
          item={editing === 'new' ? undefined : (editing as unknown as Department)}
          onClose={() => {
            setEditing(null);
            void query.refetch();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={del}
        danger
        title="Delete this record?"
        description="Records that are still used by employees, assets or other locations cannot be deleted."
        confirmLabel="Delete"
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can('settings.view') ? 'general' : 'departments');

  return (
    <>
      <PageHeader title="Settings" description="Organisation defaults and reference data." />
      <div className="mb-6">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'general', label: 'General', hidden: !can('settings.view') },
            { value: 'departments', label: 'Departments' },
            { value: 'locations', label: 'Locations' },
            { value: 'types', label: 'Asset types' },
          ]}
        />
      </div>
      {tab === 'general' && <GeneralSettings />}
      {tab === 'departments' && (
        <RefList<Department>
          kind="department"
          path="/departments"
          canManage={can('department.manage')}
          columns={[
            {
              key: 'name',
              header: 'Department',
              cell: (d) => (
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{d.name}</p>
                  <p className="font-mono text-xs text-slate-500">{d.code}</p>
                </div>
              ),
            },
            {
              key: 'manager',
              header: 'Manager',
              cell: (d) => (d.manager ? `${d.manager.firstName} ${d.manager.lastName}` : '—'),
            },
            { key: 'employees', header: 'Employees', cell: (d) => d._count?.employees ?? 0 },
            { key: 'assets', header: 'Assets', cell: (d) => d._count?.assets ?? 0 },
          ]}
        />
      )}
      {tab === 'locations' && (
        <RefList<Location>
          kind="location"
          path="/locations"
          canManage={can('location.manage')}
          columns={[
            {
              key: 'name',
              header: 'Location',
              cell: (l) => (
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{l.name}</p>
                  <p className="font-mono text-xs text-slate-500">{l.code}</p>
                </div>
              ),
            },
            { key: 'type', header: 'Type', cell: (l) => label('locationType', l.type) },
            { key: 'parent', header: 'Inside', cell: (l) => l.parent?.name ?? '—' },
            { key: 'assets', header: 'Assets', cell: (l) => l._count?.assets ?? 0 },
          ]}
        />
      )}
      {tab === 'types' && (
        <RefList<AssetType>
          kind="type"
          path="/asset-types"
          canManage={can('asset_type.manage')}
          columns={[
            {
              key: 'name',
              header: 'Asset type',
              cell: (t) => (
                <span className="font-medium text-slate-900 dark:text-slate-100">{t.name}</span>
              ),
            },
            {
              key: 'category',
              header: 'Category',
              cell: (t) => label('assetCategory', t.category),
            },
            {
              key: 'dep',
              header: 'Depreciation',
              cell: (t) => (t.depreciationMonths ? `${t.depreciationMonths} months` : '—'),
            },
            { key: 'assets', header: 'Assets', cell: (t) => t._count?.assets ?? 0 },
            {
              key: 'active',
              header: 'Status',
              cell: (t) =>
                t.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>,
            },
          ]}
        />
      )}
    </>
  );
}
