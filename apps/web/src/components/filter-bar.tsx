'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDebounced } from '@/lib/hooks';
import { Button } from './ui/button';
import { Input } from './ui/form';

/** One row of filters above a list: debounced search plus any number of selects. */
export function FilterBar({
  search,
  onSearch,
  placeholder = 'Search…',
  children,
  onReset,
  showReset,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
  onReset?: () => void;
  showReset?: boolean;
}) {
  const [text, setText] = useState(search);
  const debounced = useDebounced(text, 300);

  useEffect(() => setText(search), [search]);
  useEffect(() => {
    if (debounced !== search) onSearch(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center">
      <div className="relative lg:w-72">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
          aria-label="Search"
          type="search"
        />
      </div>
      {children && (
        <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:sm:w-44">
          {children}
        </div>
      )}
      {showReset && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} icon={<X className="h-4 w-4" />}>
          Reset
        </Button>
      )}
    </div>
  );
}
