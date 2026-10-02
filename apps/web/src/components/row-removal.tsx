'use client';

import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';

/**
 * The remove action a list row carries: a trash button per row, and one confirmation for the page.
 * Records are archived rather than erased, and the API refuses while something still depends on
 * them — its message is what the toast shows.
 */
export function useRowRemoval<T extends { id: string }>(options: {
  /** Where to send the DELETE for this row. */
  endpoint: (item: T) => string;
  /** What to call it in the confirmation and the toast. */
  name: (item: T) => string;
  /** What happens to it, shown under the question. */
  description?: string;
  onDone: () => void;
}): { button: (item: T) => ReactNode; dialog: ReactNode } {
  const toast = useToast();
  const [target, setTarget] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.delete(options.endpoint(target));
      toast.success(`${options.name(target)} removed`);
      options.onDone();
      setTarget(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return {
    button: (item: T) => (
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove ${options.name(item)}`}
          icon={<Trash2 className="h-4 w-4" />}
          onClick={(e) => {
            e.stopPropagation();
            setTarget(item);
          }}
        />
      </div>
    ),
    dialog: (
      <ConfirmDialog
        open={target !== null}
        loading={busy}
        onClose={() => setTarget(null)}
        onConfirm={remove}
        title={`Remove ${target ? options.name(target) : ''}?`}
        description={
          options.description ??
          'It is archived, so the records that mention it stay as they are. Anything still using it has to be moved first.'
        }
        confirmLabel="Remove"
        danger
      />
    ),
  };
}
