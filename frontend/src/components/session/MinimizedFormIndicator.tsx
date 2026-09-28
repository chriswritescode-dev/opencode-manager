import { X } from 'lucide-react'
import type { FormInfo } from '@opencode-manager/shared/opencode'
import { getFormText } from '@opencode-manager/shared/notifications'

interface MinimizedFormIndicatorProps {
  form: FormInfo
  onRestore: () => void
  onDismiss: () => void
}

export function MinimizedFormIndicator({ form, onRestore, onDismiss }: MinimizedFormIndicatorProps) {
  return (
    <div className="w-full bg-gradient-to-br from-highlight/10 to-highlight/20 border-2 border-highlight/40 rounded-lg shadow-lg mb-2 overflow-hidden">
      <div className="flex items-center px-3 py-2 sm:px-4 sm:py-2.5 border-b border-highlight/20 bg-highlight/5">
        <button
          onClick={onRestore}
          className="flex-1 text-left text-xs font-semibold text-highlight"
        >
          {getFormText(form) || 'Form pending'}
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss form"
          className="p-1.5 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors hidden sm:block"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
