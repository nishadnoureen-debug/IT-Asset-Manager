'use client';

import { useParams } from 'next/navigation';
import { BackLink } from '@/components/back-link';
import { PageHeader } from '@/components/ui/card';
import { QueryState } from '@/components/ui/states';
import { AssetForm } from '@/features/assets/asset-form';
import { useApi } from '@/lib/hooks';
import type { AssetDetail } from '@/lib/types';

export default function EditAssetPage() {
  const { id } = useParams<{ id: string }>();
  const query = useApi<AssetDetail>(`/assets/${id}`, undefined, { placeholderData: undefined });
  return (
    <div className="mx-auto max-w-4xl">
      <QueryState query={query}>
        {(asset) => (
          <>
            <PageHeader
              back={<BackLink href={`/assets/${id}`}>{asset.assetTag}</BackLink>}
              title={`Edit ${asset.assetTag}`}
            />
            <AssetForm asset={asset} />
          </>
        )}
      </QueryState>
    </div>
  );
}
