'use client';

import { useMemo, useState } from 'react';

type FilterDropdownOption = {
  id: string;
  name: string;
};

type FilterDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  prefixLabel?: string;
};

export function FilterDropdown({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  className = '',
  buttonClassName = '',
  prefixLabel,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = useMemo(
    () => options.find((option) => option.id === value)?.name ?? options[0]?.name ?? '',
    [options, value],
  );

  return (
    <div
      className={`relative ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
          }
        }}
        disabled={disabled}
        className={`flex min-w-[190px] items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-text shadow-[0_4px_12px_rgba(15,23,42,0.06)] transition hover:border-border/80 disabled:cursor-not-allowed disabled:text-muted/80 ${buttonClassName}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className="flex min-w-0 items-center gap-2">
          {prefixLabel ? (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {prefixLabel}
            </span>
          ) : null}
          <span className="truncate">{selectedLabel}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-muted transition ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.45rem)] z-30 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_14px_32px_rgba(15,23,42,0.2)]">
          <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {options.map((option) => {
              const isActive = value === option.id;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.id);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      isActive
                        ? 'bg-[#00B67A]/12 text-[#00B67A]'
                        : 'text-text hover:bg-[var(--surface-soft)]'
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className="truncate">{option.name}</span>
                    {isActive ? (
                      <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                        Selected
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
