import type { ReactNode } from 'react'

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-8 pb-10 text-center">
      {icon && <div className="mb-2 text-label-quaternary">{icon}</div>}
      <p className="font-display text-headline font-semibold text-label-secondary">{title}</p>
      {children && <p className="max-w-64 text-footnote text-balance text-label-secondary">{children}</p>}
    </div>
  )
}
