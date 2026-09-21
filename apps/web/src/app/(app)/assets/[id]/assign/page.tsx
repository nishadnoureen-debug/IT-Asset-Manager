'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { EmployeePicker, EnumSelect, LocationSelect } from '@/components/pickers';
import { SignaturePad } from '@/components/signature-pad';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorState, QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AssetSummary } from '@/features/assets/asset-summary';
import { ApiError } from '@/lib/api-client';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { Accessory, AssetDetail, Assignment } from '@/lib/types';

export default function AssignAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useApi<AssetDetail>(`/assets/${id}`, undefined, { placeholderData: undefined });
  const accessories = useApi<Accessory[]>('/accessories', { limit: 100 });
  const mutation = useApiMutation<Record<string, unknown>, Assignment>(
    'post',
    `/assets/${id}/assign`,
    ['/assets', '/assignments', '/accessories', '/employees'],
  );

  const [target, setTarget] = useState<'employee' | 'location'>('employee');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ accessoryId: string; quantity: number }[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const available = (accessories.data?.data ?? []).filter(
    (a) => a.quantityAvailable > 0 && !lines.some((l) => l.accessoryId === a.id),
  );

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    if (target === 'employee' && !employeeId)
      return setFieldErrors({ employeeId: 'Choose an employee' });
    if (target === 'location' && !locationId)
      return setFieldErrors({ locationId: 'Choose a location' });
    try {
      await mutation.mutateAsync({
        employeeId: target === 'employee' ? employeeId : undefined,
        locationId: target === 'location' ? locationId : locationId || undefined,
        condition,
        expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : undefined,
        notes: notes || undefined,
        accessories: target === 'employee' && lines.length ? lines : undefined,
        signature: signature ?? undefined,
      });
      toast.success(
        signature
          ? 'Assigned and signed — handover form generated'
          : 'Assigned — the employee will be asked to acknowledge',
      );
      router.replace(`/assets/${id}?tab=assignments`);
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.message);
      } else setError('Assignment failed');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <QueryState query={query}>
        {(asset) =>
          !asset.allowedActions.includes('assign') ? (
            <ErrorState
              error={
                new Error(
                  `${asset.assetTag} cannot be assigned right now (status: ${asset.status.toLowerCase().replace('_', ' ')}).`,
                )
              }
            />
          ) : (
            <>
              <PageHeader
                back={<BackLink href={`/assets/${id}`}>{asset.assetTag}</BackLink>}
                title="Assign asset"
              />
              <div className="space-y-4">
                <AssetSummary asset={asset} />
                <FormError message={error} />

                <Card>
                  <CardHeader title="Assign to" />
                  <CardBody className="space-y-4">
                    <div
                      role="radiogroup"
                      aria-label="Assign to"
                      className="grid grid-cols-2 gap-2"
                    >
                      {(['employee', 'location'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={target === t}
                          onClick={() => setTarget(t)}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${target === t ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300' : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300'}`}
                        >
                          {t === 'employee' ? 'An employee' : 'A location / room'}
                        </button>
                      ))}
                    </div>
                    {target === 'employee' ? (
                      <Field label="Employee" required error={fieldErrors.employeeId}>
                        {(p) => (
                          <EmployeePicker
                            id={p.id}
                            invalid={p['aria-invalid']}
                            value={employeeId}
                            onChange={(v) => setEmployeeId(v)}
                          />
                        )}
                      </Field>
                    ) : null}
                    <Field
                      label={target === 'employee' ? 'Location (optional)' : 'Location'}
                      required={target === 'location'}
                      error={fieldErrors.locationId}
                      hint={
                        target === 'employee' ? "Defaults to the employee's location" : undefined
                      }
                    >
                      {(p) => (
                        <LocationSelect
                          {...p}
                          placeholder={target === 'employee' ? 'Employee location' : 'Select…'}
                          value={locationId}
                          onChange={(e) => setLocationId(e.target.value)}
                        />
                      )}
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Condition" required>
                        {(p) => (
                          <EnumSelect
                            {...p}
                            group="assetCondition"
                            value={condition}
                            onChange={(e) => setCondition(e.target.value)}
                          />
                        )}
                      </Field>
                      <Field label="Expected return" error={fieldErrors.expectedReturnAt}>
                        {(p) => (
                          <Input
                            {...p}
                            type="date"
                            value={expectedReturnAt}
                            onChange={(e) => setExpectedReturnAt(e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                  </CardBody>
                </Card>

                {target === 'employee' && (
                  <Card>
                    <CardHeader
                      title="Accessories"
                      description="Handed over together with the device"
                    />
                    <CardBody className="space-y-3">
                      {lines.map((line) => {
                        const acc = accessories.data?.data.find((a) => a.id === line.accessoryId);
                        return (
                          <div key={line.accessoryId} className="flex items-center gap-2">
                            <span className="flex-1 truncate text-sm">{acc?.name}</span>
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label="Decrease"
                              icon={<Minus className="h-3 w-3" />}
                              disabled={line.quantity <= 1}
                              onClick={() =>
                                setLines((ls) =>
                                  ls.map((l) =>
                                    l === line ? { ...l, quantity: l.quantity - 1 } : l,
                                  ),
                                )
                              }
                            />
                            <span className="w-6 text-center text-sm tabular-nums">
                              {line.quantity}
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              aria-label="Increase"
                              icon={<Plus className="h-3 w-3" />}
                              disabled={!!acc && line.quantity >= acc.quantityAvailable}
                              onClick={() =>
                                setLines((ls) =>
                                  ls.map((l) =>
                                    l === line ? { ...l, quantity: l.quantity + 1 } : l,
                                  ),
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Remove"
                              icon={<Trash2 className="h-4 w-4" />}
                              onClick={() => setLines((ls) => ls.filter((l) => l !== line))}
                            />
                          </div>
                        );
                      })}
                      <Select
                        aria-label="Add accessory"
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          setLines((ls) => [...ls, { accessoryId: e.target.value, quantity: 1 }])
                        }
                      >
                        <option value="">+ Add accessory…</option>
                        {available.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.quantityAvailable} available)
                          </option>
                        ))}
                      </Select>
                    </CardBody>
                  </Card>
                )}

                <Card>
                  <CardHeader
                    title="Acknowledgement"
                    description="Optional — if the employee signs now, the handover is acknowledged immediately."
                  />
                  <CardBody className="space-y-4">
                    {target === 'employee' && (
                      <SignaturePad onChange={setSignature} label="Employee signature" />
                    )}
                    <Field label="Notes">
                      {(p) => (
                        <Textarea
                          {...p}
                          rows={2}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                        />
                      )}
                    </Field>
                  </CardBody>
                </Card>

                <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
                  <Button
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    onClick={() => router.back()}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 sm:flex-none"
                    onClick={submit}
                    loading={mutation.isPending}
                  >
                    Assign asset
                  </Button>
                </div>
              </div>
            </>
          )
        }
      </QueryState>
    </div>
  );
}
