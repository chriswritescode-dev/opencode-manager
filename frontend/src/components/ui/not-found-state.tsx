import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

interface NotFoundStateProps {
  message: string
  backTo: string
  backLabel: string
  title?: string
}

export function NotFoundState({ message, backTo, backLabel, title }: NotFoundStateProps) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-background p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        {title && <h1 className="text-lg font-semibold text-foreground">{title}</h1>}
        <span className="text-muted-foreground">{message}</span>
        <Button variant="outline" size="sm" onClick={() => navigate(backTo)}>{backLabel}</Button>
      </div>
    </div>
  )
}
