import { Laptop } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { fullName } from '@/lib/format';
import type { AssetDetail } from '@/lib/types';

/** Compact asset header used at the top of the assign / return / transfer workflows. */
export function AssetSummary({ asset }: { asset: AssetDetail }) {
  const current = asset.currentAssignment;
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className="rounded-lg bg-blue-50 p-3 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
        <Laptop className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{asset.assetTag}</p>
          <StatusBadge group="assetStatus" value={asset.status} />
        </div>
        <p className="truncate text-sm text-slate-600 dark:text-slate-400">
          {asset.name}
          {asset.serialNumber && (
            <span className="font-mono text-xs"> · S/N {asset.serialNumber}</span>
          )}
        </p>
        {current && (
          <p className="text-sm text-slate-500">
            With {current.employee ? fullName(current.employee) : current.location?.name}
          </p>
        )}
      </div>
    </Card>
  );
}
