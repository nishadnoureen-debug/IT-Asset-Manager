'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignaturePad } from '@/components/signature-pad';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useApiMutation } from '@/lib/hooks';

type Kind = 'retire' | 'dispose' | 'report_lost' | 'acknowledge';

/** Small lifecycle dialogs on the asset page (retire, dispose, report lost, acknowledge). */
export function AssetActionDialog({
  kind,
  onClose,
  asset,
  assignmentId,
}: {
  kind: Kind | null;
  onClose: () => void;
  asset: { id: string; assetTag: string; name: string };
  assignmentId?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('Certified e-waste recycling');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = ['/assets', '/assignments', '/tickets'];
  const retire = useApiMutation('post', `/assets/${asset.id}/retire`, invalidate);
  const dispose = useApiMutation('post', `/assets/${asset.id}/dispose`, invalidate);
  const lost = useApiMutation<unknown, { ticketId: string; ticketNumber: number }>(
    'post',
    `/assets/${asset.id}/report-lost`,
    invalidate,
  );
  const ack = useApiMutation('post', `/assignments/${assignmentId}/acknowledge`, invalidate);
  const pending = retire.isPending || dispose.isPending || lost.isPending || ack.isPending;

  const close = () => {
    setReason('');
    setSignature(null);
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    try {
      if (kind === 'retire') {
        await retire.mutateAsync({ reason });
        toast.success(`${asset.assetTag} retired`);
      } else if (kind === 'dispose') {
        await dispose.mutateAsync({ method, reason });
        toast.success(`${asset.assetTag} disposed`);
      } else if (kind === 'report_lost') {
        const { data } = await lost.mutateAsync({ notes: reason });
        toast.success(`Reported lost — ticket TCK-${data.ticketNumber} created`);
        close();
        router.push(`/tickets/${data.ticketId}`);
        return;
      } else if (kind === 'acknowledge') {
        await ack.mutateAsync({ signature: signature ?? undefined });
        toast.success('Thank you — receipt acknowledged');
      }
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
    }
  };

  const config = {
    retire: {
      title: `Retire ${asset.assetTag}?`,
      description: 'Retired assets are taken out of service. They can be disposed of later.',
      button: 'Retire asset',
      danger: true,
    },
    dispose: {
      title: `Dispose ${asset.assetTag}?`,
      description: 'Disposal is final. The asset stays in the records for audit purposes.',
      button: 'Dispose asset',
      danger: true,
    },
    report_lost: {
      title: `Report ${asset.assetTag} lost`,
      description: 'The assignment is closed and a high-priority loss ticket is raised for IT.',
      button: 'Report lost',
      danger: true,
    },
    acknowledge: {
      title: `Acknowledge ${asset.assetTag}`,
      description: `Confirm you received "${asset.name}" in the recorded condition.`,
      button: 'I confirm receipt',
      danger: false,
    },
  } as const;
  const c = kind ? config[kind] : null;
  const needsReason = kind === 'retire' || kind === 'dispose' || kind === 'report_lost';

  return (
    <Dialog
      open={!!kind}
      onClose={close}
      title={c?.title ?? ''}
      description={c?.description}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={c?.danger ? 'danger' : 'primary'}
            onClick={submit}
            loading={pending}
            disabled={needsReason && reason.trim().length < 3}
          >
            {c?.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        {kind === 'dispose' && (
          <Field label="Disposal method" required>
            {(p) => <Input {...p} value={method} onChange={(e) => setMethod(e.target.value)} />}
          </Field>
        )}
        {needsReason && (
          <Field
            label={kind === 'report_lost' ? 'What happened?' : 'Reason'}
            required
            hint="At least 3 characters"
          >
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
            )}
          </Field>
        )}
        {kind === 'acknowledge' && <SignaturePad onChange={setSignature} />}
      </div>
    </Dialog>
  );
}
