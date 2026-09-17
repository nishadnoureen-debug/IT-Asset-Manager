import clsx from 'clsx';
import { forwardRef, useId } from 'react';

const control =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800 aria-[invalid=true]:border-red-500';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(control, 'h-10', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={clsx(control, 'py-2', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={clsx(control, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

/** Label + control + hint/error, wired for accessibility. */
export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900"
        {...props}
      />
      {label}
    </label>
  );
}

export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-1 gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      {message}
    </div>
  );
}
