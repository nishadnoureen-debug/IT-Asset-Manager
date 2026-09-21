'use client';

import { Download, FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatBytes, formatDateTime, label } from '@/lib/format';
import type { DocumentItem } from '@/lib/types';
import { EnumSelect } from './pickers';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/dialog';
import { Input } from './ui/form';
import { EmptyState } from './ui/states';
import { useToast } from './ui/toast';

const PROTECTED = ['HANDOVER_FORM', 'RETURN_FORM', 'SIGNATURE'];

/** Document list with download, upload (if permitted) and delete. `owner` is e.g. `{ assetId }`. */
export function Documents({
  documents,
  owner,
  invalidate,
  defaultType = 'OTHER',
}: {
  documents: DocumentItem[] | undefined;
  owner: Record<string, string>;
  /** Query path prefixes to refresh after upload/delete. */
  invalidate: string[];
  defaultType?: string;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(defaultType);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<DocumentItem | null>(null);

  const refresh = () => {
    for (const prefix of invalidate) {
      void qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix),
      });
    }
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error(new Error('Choose a file to upload'));
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    if (title.trim()) form.append('title', title.trim());
    for (const [k, v] of Object.entries(owner)) form.append(k, v);
    setBusy(true);
    try {
      await api.post('/documents', form);
      toast.success('Document uploaded');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      refresh();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/documents/${toDelete.id}`);
      toast.success('Document deleted');
      setToDelete(null);
      refresh();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {documents && documents.length === 0 && (
        <EmptyState
          title="No documents"
          description="Invoices, warranties, photos and forms appear here."
        />
      )}
      {documents && documents.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-3">
              <span className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-slate-800">
                {doc.mimeType.startsWith('image/') ? (
                  <ImageIcon className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {doc.title}
                </p>
                <p className="text-xs text-slate-500">
                  {label('documentType', doc.type)} · {formatBytes(doc.sizeBytes)} ·{' '}
                  {formatDateTime(doc.createdAt)}
                  {doc.uploadedBy && ` · ${doc.uploadedBy.displayName}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Download ${doc.title}`}
                icon={<Download className="h-4 w-4" />}
                onClick={() =>
                  downloadFile(`/documents/${doc.id}/download`).catch((e) => toast.error(e))
                }
              />
              {can('document.delete') && !PROTECTED.includes(doc.type) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${doc.title}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setToDelete(doc)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {can('document.upload') && (
        <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Upload a document
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <EnumSelect
              group="documentType"
              exclude={PROTECTED}
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Document type"
            />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              aria-label="Title"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="min-w-0 flex-1 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
              aria-label="File"
            />
            <Button size="sm" onClick={upload} loading={busy} icon={<Upload className="h-4 w-4" />}>
              Upload
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">PDF, PNG, JPEG or WebP, up to 10 MB.</p>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete document?"
        description={`"${toDelete?.title}" will be removed from this record.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
