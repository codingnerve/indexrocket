import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

/** Wide tables scroll inside their card; the page itself never scrolls sideways. */
export function TableContainer({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('overflow-x-auto overscroll-x-contain', className)}>{children}</div>;
}

export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn('w-full border-collapse text-sm', className)} {...props}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-subtle/60">{children}</tr>
    </thead>
  );
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-4 text-left align-middle text-2xs font-medium tracking-wider whitespace-nowrap text-muted uppercase',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, children, selected, ...props }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      className={cn('transition-colors hover:bg-card-hover', selected ? 'bg-primary-soft/40 hover:bg-primary-soft/60' : '', className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Td({ className, children, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 align-middle text-foreground', className)} {...props}>
      {children}
    </td>
  );
}
