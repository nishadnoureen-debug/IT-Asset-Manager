'use client';

import { FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { useState } from 'react';
import { DepartmentSelect, EnumSelect, LocationSelect, VendorSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { AuditSession, ReportColumn, ReportResult } from '@/lib/types';

const DESCRIPTIONS: Record<string, string> = {
  assets: 'Full inventory with status, location, holder, cost and warranty.',
  assignments: 'Who had which asset and when, including condition in/out.',
  purchases: 'Purchase orders and invoices with totals per vendor.',
  maintenance: 'Repairs and upgrades with technicians, vendors and costs.',
  warranty: 'Warranty coverage and days remaining per asset.',
  software: 'Licences, seat usage and expiry.',
  audit: 'Results of an inventory audit, including discrepancies.',
  departments: 'Asset counts per status and purchase value per department.',
  locations: 'Asset counts per status at each location.',
  lifecycle: 'Every lifecycle event across assets.',
};

type Filters = Record<string, string>;

const FILTERS_BY_TYPE: Record<string, string[]> = {
  assets: ['status', 'locationId', 'departmentId', 'vendorId'],
  assignments: ['assignmentStatus', 'departmentId', 'from', 'to'],
  purchases: ['vendorId', 'from', 'to'],
  maintenance: ['maintenanceStatus', 'vendorId', 'from', 'to'],
  warranty: ['days', 'locationId', 'departmentId'],
  software: ['days', 'vendorId'],
  audit: ['auditId', 'auditResult'],
  departments: [],
  locations: [],
  lifecycle: ['from', 'to'],
};

function Cell({ value, column }: { value: unknown; column: ReportColumn }) {
  if (value === null || value === undefined || value === '')
    return <span className="text-slate-400">—</span>;
  if (column.type === 'date') return <>{formatDate(String(value))}</>;
  if (column.type === 'datetime') return <>{formatDateTime(String(value))}</>;
  if (column.type === 'money') {
    return (
      <span className="tabular-nums">
        {Number(value).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    );
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  return <>{String(value)}</>;
}

export default function ReportsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const catalogue = useApi<{ type: string; title: string }[]>('/reports');
  const [type, setType] = useState('assets');
  const [filters, setFilters] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});
  const [exporting, setExporting] = useState<string | null>(null);
  const audits = useApi<AuditSession[]>(type === 'audit' ? '/audits' : null, { limit: 50 });

  const query = buildQuery(type, applied);
  const ready = type !== 'audit' || !!applied.auditId;
  const report = useApi<ReportResult>(
    ready ? `/reports/${type}` : null,
    { ...query, limit: 200 },
    { placeholderData: undefined },
  );

  const setFilter = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const choose = (t: string) => {
    setType(t);
    setFilters({});
    setApplied({});
  };

  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      await downloadFile(`/reports/${type}`, { query: { ...buildQuery(type, applied), format } });
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(null);
    }
  };

  const fields = FILTERS_BY_TYPE[type] ?? [];
  const available = catalogue.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Preview on screen, then export to CSV, Excel or PDF."
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <nav aria-label="Reports" className="p-2">
            {catalogue.isLoading && <Spinner />}
            {available.map((r) => (
              <button
                key={r.type}
                type="button"
                onClick={() => choose(r.type)}
                aria-current={r.type === type}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${r.type === type ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {r.title}
              </button>
            ))}
          </nav>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={available.find((r) => r.type === type)?.title ?? 'Report'}
              description={DESCRIPTIONS[type]}
              actions={
                can('report.export') && ready ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exporting === 'csv'}
                      onClick={() => exportAs('csv')}
                      icon={<Sheet className="h-4 w-4" />}
                    >
                      CSV
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exporting === 'xlsx'}
                      onClick={() => exportAs('xlsx')}
                      icon={<FileSpreadsheet className="h-4 w-4" />}
                    >
                      Excel
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={exporting === 'pdf'}
                      onClick={() => exportAs('pdf')}
                      icon={<FileText className="h-4 w-4" />}
                    >
                      PDF
                    </Button>
                  </>
                ) : undefined
              }
            />
            {fields.length > 0 && (
              <CardBody>
                <form
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setApplied(filters);
                  }}
                >
                  {fields.includes('status') && (
                    <Field label="Status">
                      {(p) => (
                        <EnumSelect
                          {...p}
                          group="assetStatus"
                          placeholder="Any"
                          value={filters.status ?? ''}
                          onChange={(e) => setFilter('status', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('assignmentStatus') && (
                    <Field label="Status">
                      {(p) => (
                        <EnumSelect
                          {...p}
                          group="assignmentStatus"
                          placeholder="Any"
                          value={filters.status ?? ''}
                          onChange={(e) => setFilter('status', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('maintenanceStatus') && (
                    <Field label="Status">
                      {(p) => (
                        <EnumSelect
                          {...p}
                          group="maintenanceStatus"
                          placeholder="Any"
                          value={filters.status ?? ''}
                          onChange={(e) => setFilter('status', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('auditResult') && (
                    <Field label="Result">
                      {(p) => (
                        <EnumSelect
                          {...p}
                          group="auditResult"
                          placeholder="Any"
                          value={filters.status ?? ''}
                          onChange={(e) => setFilter('status', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('locationId') && (
                    <Field label="Location">
                      {(p) => (
                        <LocationSelect
                          {...p}
                          placeholder="Any"
                          value={filters.locationId ?? ''}
                          onChange={(e) => setFilter('locationId', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('departmentId') && (
                    <Field label="Department">
                      {(p) => (
                        <DepartmentSelect
                          {...p}
                          placeholder="Any"
                          value={filters.departmentId ?? ''}
                          onChange={(e) => setFilter('departmentId', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('vendorId') && can('vendor.view') && (
                    <Field label="Vendor">
                      {(p) => (
                        <VendorSelect
                          {...p}
                          placeholder="Any"
                          value={filters.vendorId ?? ''}
                          onChange={(e) => setFilter('vendorId', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('from') && (
                    <Field label="From">
                      {(p) => (
                        <Input
                          {...p}
                          type="date"
                          value={filters.from ?? ''}
                          onChange={(e) => setFilter('from', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('to') && (
                    <Field label="To">
                      {(p) => (
                        <Input
                          {...p}
                          type="date"
                          value={filters.to ?? ''}
                          onChange={(e) => setFilter('to', e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                  {fields.includes('days') && (
                    <Field label={type === 'software' ? 'Expiring within' : 'Ending within'}>
                      {(p) => (
                        <Select
                          {...p}
                          value={filters.days ?? ''}
                          onChange={(e) => setFilter('days', e.target.value)}
                        >
                          <option value="">Any time</option>
                          <option value="30">30 days</option>
                          <option value="60">60 days</option>
                          <option value="90">90 days</option>
                          <option value="365">1 year</option>
                        </Select>
                      )}
                    </Field>
                  )}
                  {fields.includes('auditId') && (
                    <Field label="Audit" required>
                      {(p) => (
                        <Select
                          {...p}
                          value={filters.auditId ?? ''}
                          onChange={(e) => setFilter('auditId', e.target.value)}
                        >
                          <option value="">Choose an audit…</option>
                          {(audits.data?.data ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              AUD-{a.number} {a.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                  <div className="flex items-end">
                    <Button type="submit" className="w-full sm:w-auto">
                      Apply
                    </Button>
                  </div>
                </form>
              </CardBody>
            )}
          </Card>

          <Card>
            {!ready ? (
              <EmptyState title="Choose an audit to see its report" />
            ) : report.isLoading ? (
              <Spinner label="Running report" />
            ) : report.error ? (
              <ErrorState error={report.error} onRetry={() => void report.refetch()} />
            ) : report.data ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 text-sm text-slate-500 dark:border-slate-800">
                  <span>
                    {report.data.data.total} rows
                    {report.data.data.total > report.data.data.rows.length &&
                      ` · showing the first ${report.data.data.rows.length} (export for all)`}
                  </span>
                  <span>Generated {formatDateTime(report.data.data.generatedAt)}</span>
                </div>
                {report.data.data.rows.length ? (
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                        <tr>
                          {report.data.data.columns.map((c) => (
                            <th
                              key={c.key}
                              scope="col"
                              className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {report.data.data.rows.map((row, i) => (
                          <tr key={i}>
                            {report.data!.data.columns.map((c) => (
                              <td
                                key={c.key}
                                className="whitespace-nowrap px-4 py-2 text-slate-700 dark:text-slate-300"
                              >
                                <Cell value={row[c.key]} column={c} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No rows for these filters" />
                )}
              </>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function buildQuery(type: string, f: Filters): Record<string, string | undefined> {
  const q: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(f)) if (v) q[k] = v;
  if (q.from) q.from = new Date(q.from).toISOString();
  if (q.to) q.to = new Date(`${q.to}T23:59:59`).toISOString();
  if (type !== 'audit') delete q.auditId;
  return q;
}
