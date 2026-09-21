'use client';

import { BackLink } from '@/components/back-link';
import { PageHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { AssetForm } from '@/features/assets/asset-form';
import { useAuth } from '@/lib/auth';

export default function NewAssetPage() {
  const { can } = useAuth();
  if (!can('asset.create'))
    return <ErrorState error={Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' })} />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={<BackLink href="/assets">Assets</BackLink>}
        title="Register asset"
        description="A QR label is generated automatically once the asset is saved."
      />
      <AssetForm />
    </div>
  );
}
