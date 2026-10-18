'use client';

import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

// Primitif mini fase 1 (turunin gaya shadcn; bisa di-milestone jadi shadcn/ui belakangan).

type Variant = 'default' | 'ghost' | 'subtle' | 'outline';

const variantClasses: Record<Variant, string> = {
  default: 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300',
  ghost: 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300',
  subtle: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700',
  outline: 'border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300',
};

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses['ghost']} ${className}`}
      {...props}
    />
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-200 ${className}`}
      {...props}
    />
  );
}

/** Modal minimal (overlay + Esc + klik luar). */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Lebar 'lg' buat konten lebar (diff review, tabel). Default 'sm' (max-w-md). */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={`${wide ? 'w-full max-w-3xl' : 'w-full max-w-md'} max-h-[85vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900`}>
        <h2 className="mb-4 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function SegmentedGroup({
  options,
  active,
  onSelect,
}: {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  active: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          onClick={() => !option.disabled && onSelect(option.value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
            active === option.value
              ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatusDot({ tone = 'idle', title }: { tone?: 'green' | 'amber' | 'red' | 'idle'; title?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    idle: 'bg-neutral-400',
  };
  return <span title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${colors[tone]}`} />;
}
