'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { FORM_SIGNATORIES_MAX, type AppSettings, type FormSignatory } from '@itam/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useApi, useApiMutation } from '@/lib/hooks';

interface FormsForm {
  formFooter: string;
  formTerms: string;
  formSignatories: FormSignatory[];
}

/** Letterhead footer, terms and "Approved by" boxes printed on handover, transfer and return forms. */
export function FormsSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<AppSettings>('/settings', undefined, { placeholderData: undefined });
  const save = useApiMutation<Partial<AppSettings>>('patch', '/settings', ['/settings']);
  const editable = can('settings.edit');
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormsForm>({ defaultValues: { formSignatories: [] } });
  const signatories = useFieldArray({ control, name: 'formSignatories' });

  useEffect(() => {
    if (!query.data) return;
    const d = query.data.data;
    reset({
      formFooter: d.formFooter,
      formTerms: d.formTerms,
      formSignatories: d.formSignatories,
    });
  }, [query.data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        formFooter: v.formFooter,
        formTerms: v.formTerms,
        formSignatories: v.formSignatories
          .map((s) => ({ title: s.title.trim(), name: s.name.trim() }))
          .filter((s) => s.title),
      });
      toast.success('Form settings saved');
    } catch (e) {
      if (e instanceof ApiError) setError('root', { message: e.message });
    }
  });

  return (
    <Card>
      <CardHeader
        title="Handover, transfer and return forms"
        description="Printed on every generated form, under the company letterhead."
      />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-5">
          <FormError message={errors.root?.message} />
          <fieldset disabled={!editable} className="space-y-5">
            <Field
              label="Footer"
              hint="Printed at the bottom of every page (one line per row)."
              error={errors.formFooter?.message}
            >
              {(p) => <Textarea {...p} rows={2} {...register('formFooter')} />}
            </Field>
            <Field
              label="Terms & Conditions"
              hint="One per line. {company} is replaced with the company name."
              error={errors.formTerms?.message}
            >
              {(p) => <Textarea {...p} rows={7} {...register('formTerms')} />}
            </Field>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Approved by</p>
              <p className="mb-2 text-xs text-slate-500">
                Signature boxes, three per row. Leave a name empty to write it by hand.
              </p>
              <div className="space-y-2">
                {signatories.fields.map((field, i) => (
                  <div key={field.id} className="flex items-end gap-2">
                    <Field label={i === 0 ? 'Title' : ''} className="flex-1">
                      {(p) => (
                        <Input
                          {...p}
                          aria-label={`Signatory ${i + 1} title`}
                          placeholder="e.g. HR Department"
                          {...register(`formSignatories.${i}.title` as const, { required: true })}
                        />
                      )}
                    </Field>
                    <Field label={i === 0 ? 'Name' : ''} className="flex-1">
                      {(p) => (
                        <Input
                          {...p}
                          aria-label={`Signatory ${i + 1} name`}
                          placeholder="Optional"
                          {...register(`formSignatories.${i}.name` as const)}
                        />
                      )}
                    </Field>
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Remove signatory ${i + 1}`}
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => signatories.remove(i)}
                      />
                    )}
                  </div>
                ))}
              </div>
              {editable && signatories.fields.length < FORM_SIGNATORIES_MAX && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => signatories.append({ title: '', name: '' })}
                >
                  Add signatory
                </Button>
              )}
            </div>
          </fieldset>
          {editable && (
            <div className="flex justify-end">
              <Button type="submit" disabled={!isDirty} loading={save.isPending}>
                Save form settings
              </Button>
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
