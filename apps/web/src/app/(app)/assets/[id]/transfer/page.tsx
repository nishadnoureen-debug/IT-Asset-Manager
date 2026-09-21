'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { EmployeePicker, EnumSelect, LocationSelect } from '@/components/pickers';
import { SignaturePad } from '@/components/signature-pad';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { ErrorState, QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AssetSummary } from '@/features/assets/asset-summary';
import { ApiError } from '@/lib/api-client';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { AssetDetail } from '@/lib/types';

export default function TransferAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useApi<AssetDetail>(`/assets/${id}`, undefined, { placeholderData: undefined });
  const mutation = useApiMutation<Record<string, unknown>>('post', `/assets/${id}/transfer`, [
    '/assets',
    '/assignments',
    '/employees',
  ]);

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    if (!employeeId && !locationId)
      return setFieldErrors({ employeeId: 'Choose the new employee or location' });
    if (reason.trim().length < 3)
      return setFieldErrors({ reason: 'Give a reason for the transfer' });
    try {
      await mutation.mutateAsync({
        employeeId: employeeId ?? undefined,
        locationId: locationId || undefined,
        reason,
        condition,
        expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : undefined,
        notes: notes || undefined,
        signature: signature ?? undefined,
      });
      toast.success('Transferred — new handover form generated');
      router.replace(`/assets/${id}?tab=assignments`);
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.message);
      } else setError('Transfer failed');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <QueryState query={query}>
        {(asset) =>
          !asset.allowedActions.includes('transfer') ? (
            <ErrorState
              error={
                new Error(`${asset.assetTag} is not currently assigned, or you cannot transfer it.`)
              }
            />
          ) : (
            <>
              <PageHeader
                back={<BackLink href={`/assets/${id}`}>{asset.assetTag}</BackLink>}
                title="Transfer asset"
                description="Closes the current assignment and opens a new one — the history keeps both."
              />
              <div className="space-y-4">
                <AssetSummary asset={asset} />
                <FormError message={error} />
                <Card>
                  <CardHeader title="New holder" />
                  <CardBody className="space-y-4">
                    <Field label="Employee" error={fieldErrors.employeeId}>
                      {(p) => (
                        <EmployeePicker
                          id={p.id}
                          invalid={p['aria-invalid']}
                          value={employeeId}
                          onChange={setEmployeeId}
                        />
                      )}
                    </Field>
                    <Field
                      label="Location"
                      error={fieldErrors.locationId}
                      hint="Leave empty to use the employee's location"
                    >
                      {(p) => (
                        <LocationSelect
                          {...p}
                          placeholder="Not changed"
                          value={locationId}
                          onChange={(e) => setLocationId(e.target.value)}
                        />
                      )}
                    </Field>
                    <Field label="Reason" required error={fieldErrors.reason}>
                      {(p) => (
                        <Input
                          {...p}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="e.g. Role change, desk move"
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
                      <Field label="Expected return">
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
                <Card>
                  <CardHeader
                    title="Acknowledgement"
                    description="Optional signature from the new holder"
                  />
                  <CardBody className="space-y-4">
                    <SignaturePad onChange={setSignature} label="New holder's signature" />
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
                    Transfer asset
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
