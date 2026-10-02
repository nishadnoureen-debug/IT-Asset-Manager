'use client';

import { Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { downloadFile } from '@/lib/api-client';
import { fullName, label } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Accessory, AccessoryUnit } from '@/lib/types';

/** Every piece of an accessory: its code, where it is, and the labels to print. */
export function AccessoryPieces({
  accessory,
  selected,
  onToggle,
}: {
  accessory: Accessory;
  /** Pieces ticked for the next hand-out; undefined hides the tick boxes. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const toast = useToast();
  const query = useApi<AccessoryUnit[]>(`/accessories/${accessory.id}/units`);
  const units = query.data?.data ?? [];

  const sheet = (ids?: string[]) =>
    downloadFile('/accessories/qr/labels', {
      query: ids ? { unitIds: ids } : { ids: [accessory.id] },
      fileName: `${accessory.code}-labels.pdf`,
    }).catch((e) => toast.error(e));

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <p className="text-sm font-medium">Pieces ({units.length})</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<Printer className="h-4 w-4" />}
          onClick={() => sheet()}
        >
          Print all labels
        </Button>
      </div>
      {query.isLoading ? (
        <div className="p-3">
          <Spinner />
        </div>
      ) : units.length ? (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {units.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              {selected && u.status === 'IN_STOCK' && (
                <input
                  type="checkbox"
                  aria-label={`Hand out ${u.code}`}
                  checked={selected.has(u.id)}
                  onChange={() => onToggle?.(u.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
              )}
              <span className="font-mono">{u.code}</span>
              <Badge
                tone={u.status === 'IN_STOCK' ? 'teal' : u.status === 'ASSIGNED' ? 'green' : 'gray'}
              >
                {label('accessoryUnitStatus', u.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {u.assignment?.employee ? fullName(u.assignment.employee) : ''}
                {u.assignment?.assetAssignment
                  ? ` · with ${u.assignment.assetAssignment.asset.assetTag}`
                  : ''}
                {u.serialNumber ? ` · S/N ${u.serialNumber}` : ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Label for ${u.code}`}
                icon={<Printer className="h-3.5 w-3.5" />}
                onClick={() => sheet([u.id])}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-3 text-sm text-slate-500">No pieces yet — add stock to label them.</p>
      )}
    </div>
  );
}
