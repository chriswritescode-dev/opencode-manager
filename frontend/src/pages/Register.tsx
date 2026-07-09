import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Link, useLoaderData } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, UserPlus, AlertCircle } from 'lucide-react'
import type { AuthConfig } from '@/lib/auth-loaders'

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type RegisterFormData = z.infer<typeof registerSchema>

export function Register() {
  const { t } = useTranslation()
  const { signUpWithEmail } = useAuth()
  const { config } = useLoaderData() as { config: AuthConfig }
  const theme = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const onSubmit = async (data: RegisterFormData) => {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await signUpWithEmail(data.email, data.password, data.name)
      if (result.error) {
        setError(result.error)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <img 
            src={theme === 'light' ? "/opencode-wordmark-light.svg" : "/opencode-wordmark-dark.svg"} 
            alt="OpenCode" 
            className="h-8 w-auto"
          />
          <p className="text-sm text-muted-foreground">
            {config.isFirstUser
              ? t('login.createAdminAccount')
              : t('login.register')}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm text-muted-foreground">{t('login.name')}</Label>
              <Input
                id="name"
                type="text"
                placeholder={t('login.yourNamePlaceholder')}
                className="bg-input border-border focus:border-primary"
                {...register('name')}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-muted-foreground">{t('login.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="bg-input border-border focus:border-primary"
                {...register('email')}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-muted-foreground">{t('login.password')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('login.atLeast8Chars')}
                className="bg-input border-border focus:border-primary"
                {...register('password')}
                aria-invalid={!!errors.password}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm text-muted-foreground">{t('login.confirmPassword')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('login.confirmYourPassword')}
                className="bg-input border-border focus:border-primary"
                {...register('confirmPassword')}
                aria-invalid={!!errors.confirmPassword}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {config.isFirstUser ? t('login.createAdminAccount') : t('login.registerButton')}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          {t('common.alreadyAccount')}{' '}
          <Link to="/login" className="text-primary hover:underline transition-colors">
            {t('login.loginButton')}
          </Link>
        </p>
      </div>
    </div>
  )
}
