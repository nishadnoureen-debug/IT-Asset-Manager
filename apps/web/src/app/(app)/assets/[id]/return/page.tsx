'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { EnumSelect } from '@/components/pickers';
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

interface Line {
  returned: boolean;
  condition: string;
}

export default function ReturnAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useApi<AssetDetail>(`/assets/${id}`, undefined, { placeholderData: undefined });
  const mutation = useApiMutation<Record<string, unknown>>('post', `/assets/${id}/return`, [
    '/assets',
    '/assignments',
    '/accessories',
    '/employees',
    '/maintenance',
  ]);

  const [condition, setCondition] = useState('GOOD');
  const [returnTo, setReturnTo] = useState<'IN_STOCK' | 'IN_REPAIR'>('IN_STOCK');
  const [repairTitle, setRepairTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (asset: AssetDetail) => {
    setError(null);
    try {
      await mutation.mutateAsync({
        condition,
        returnTo,
        repairTitle: returnTo === 'IN_REPAIR' ? repairTitle || undefined : undefined,
        notes: notes || undefined,
        signature: signature ?? undefined,
        accessories: asset.currentAssignment?.accessoryAssignments.map((acc) => ({
          accessoryAssignmentId: acc.id,
          returned: lines[acc.id]?.returned ?? true,
          condition: lines[acc.id]?.condition ?? condition,
        })),
      });
      toast.success(
        returnTo === 'IN_REPAIR'
          ? 'Returned and sent to repair'
          : 'Returned to stock — return form generated',
      );
      router.replace(`/assets/${id}?tab=assignments`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Return failed');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <QueryState query={query}>
        {(asset) =>
          !asset.allowedActions.includes('return') ? (
            <ErrorState
              error={
                new Error(`${asset.assetTag} is not currently assigned, or you cannot return it.`)
              }
            />
          ) : (
            <>
              <PageHeader
                back={<BackLink href={`/assets/${id}`}>{asset.assetTag}</BackLink>}
                title="Return asset"
              />
              <div className="space-y-4">
                <AssetSummary asset={asset} />
                <FormError message={error} />
                <Card>
                  <CardHeader title="Condition on return" />
                  <CardBody className="space-y-4">
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
                    <div
                      role="radiogroup"
                      aria-label="After return"
                      className="grid grid-cols-2 gap-2"
                    >
                      {(
                        [
                          ['IN_STOCK', 'Back to stock'],
                          ['IN_REPAIR', 'Send to repair'],
                        ] as const
                      ).map(([value, text]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={returnTo === value}
                          onClick={() => setReturnTo(value)}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${returnTo === value ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-300' : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300'}`}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    {returnTo === 'IN_REPAIR' && (
                      <Field
                        label="What needs repairing?"
                        hint="Opens a maintenance record in progress"
                      >
                        {(p) => (
                          <Input
                            {...p}
                            value={repairTitle}
                            onChange={(e) => setRepairTitle(e.target.value)}
                            placeholder="e.g. Cracked screen"
                          />
                        )}
                      </Field>
                    )}
                  </CardBody>
                </Card>

                {!!asset.currentAssignment?.accessoryAssignments.length && (
                  <Card>
                    <CardHeader
                      title="Accessories"
                      description="Untick anything that was not handed back — it is written off from stock."
                    />
                    <CardBody className="space-y-3">
                      {asset.currentAssignment.accessoryAssignments.map((acc) => {
                        const line = lines[acc.id] ?? { returned: true, condition };
                        return (
                          <div key={acc.id} className="flex flex-wrap items-center gap-3">
                            <label className="flex flex-1 items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300"
                                checked={line.returned}
                                onChange={(e) =>
                                  setLines((l) => ({
                                    ...l,
                                    [acc.id]: { ...line, returned: e.target.checked },
                                  }))
                                }
                              />
                              {acc.accessory.name}
                              {acc.quantity > 1 && ` × ${acc.quantity}`}
                            </label>
                            {line.returned && (
                              <EnumSelect
                                group="assetCondition"
                                className="w-36"
                                aria-label={`${acc.accessory.name} condition`}
                                value={line.condition}
                                onChange={(e) =>
                                  setLines((l) => ({
                                    ...l,
                                    [acc.id]: { ...line, condition: e.target.value },
                                  }))
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </CardBody>
                  </Card>
                )}

                <Card>
                  <CardHeader title="Confirmation" />
                  <CardBody className="space-y-4">
                    <SignaturePad onChange={setSignature} label="Signature (optional)" />
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
                    onClick={() => submit(asset)}
                    loading={mutation.isPending}
                  >
                    Complete return
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
