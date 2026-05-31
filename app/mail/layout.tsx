import type { ReactNode } from 'react'
import { MailSectionNav } from '@/components/mail/mail-section-nav'
import { isMailConfigured } from '@/service/server/mail'

export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-auto bg-[hsl(var(--app-shell-bg))] px-4 py-6 text-[hsl(var(--app-panel-text))] lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <MailSectionNav mailConfigured={isMailConfigured()} />
        {children}
      </div>
    </div>
  )
}
