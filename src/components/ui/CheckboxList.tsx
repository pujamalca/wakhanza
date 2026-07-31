'use client';

import { useMemo, useState } from 'react';

export interface CheckboxListOption {
  kode: string;
  nama: string;
}

const SEARCH_THRESHOLD = 8;

export function CheckboxList({
  name,
  options,
  defaultSelected = [],
  searchPlaceholder = 'Cari...',
}: {
  name: string;
  options: CheckboxListOption[];
  defaultSelected?: string[];
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));

  const normalizedQuery = query.trim().toLowerCase();
  const matchingKodes = useMemo(
    () => new Set(options.filter((o) => o.nama.toLowerCase().includes(normalizedQuery)).map((o) => o.kode)),
    [options, normalizedQuery],
  );
  const visibleCount = matchingKodes.size;
  const allVisibleSelected = visibleCount > 0 && options.every((o) => !matchingKodes.has(o.kode) || selected.has(o.kode));

  function toggleOne(kode: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kode)) next.delete(kode);
      else next.add(kode);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const opt of options) {
        if (!matchingKodes.has(opt.kode)) continue;
        if (allVisibleSelected) next.delete(opt.kode);
        else next.add(opt.kode);
      }
      return next;
    });
  }

  return (
    <div className="rounded-md border bg-background">
      {options.length > SEARCH_THRESHOLD && (
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {selected.size > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{selected.size} dipilih</span>}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-xs font-medium hover:bg-muted">
        <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="accent-primary" />
        Pilih semua{query && ' (hasil pencarian)'}
      </label>
      <div className="max-h-40 overflow-y-auto">
        {options.map((opt) => (
          <label
            key={opt.kode}
            className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted ${matchingKodes.has(opt.kode) ? '' : 'hidden'}`}
          >
            <input
              type="checkbox"
              name={name}
              value={opt.kode}
              checked={selected.has(opt.kode)}
              onChange={() => toggleOne(opt.kode)}
              className="accent-primary"
            />
            {opt.nama}
          </label>
        ))}
        {visibleCount === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Tidak ada hasil.</p>}
      </div>
    </div>
  );
}
