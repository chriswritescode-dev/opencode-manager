import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react'
import {
  OPENCODE_SERVER_LINK_VERSION,
  OPENCODE_SERVER_USERNAME,
  parseOpenCodeServerLink,
  readOpenCodeServerLinkVersion,
  type OpenCodeServer,
  type OpenCodeServerLink,
  type OpenCodeServerTestResult,
} from '@opencode-manager/shared/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { QrCodeScanner } from './QrCodeScanner'

export interface OpenCodeServerFormValues {
  name: string
  baseUrl: string
  username: string
  password: string
  enabled: boolean
  clearPassword: boolean
  pairing: OpenCodeServerLink['pairing'] | null
}

interface OpenCodeServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  server?: OpenCodeServer | null
  onSubmit: (values: OpenCodeServerFormValues) => Promise<void>
  onTest: (values: OpenCodeServerFormValues) => Promise<OpenCodeServerTestResult>
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

const serverFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  baseUrl: z
    .string()
    .trim()
    .min(1, 'URL is required')
    .refine(isHttpUrl, 'Enter a URL starting with http:// or https://'),
  username: z
    .string()
    .trim()
    .min(1, 'Username is required')
    .max(100, 'Username must be 100 characters or fewer'),
  password: z.string().max(1024, 'Password is too long'),
  enabled: z.boolean(),
})

type ServerFormValues = z.infer<typeof serverFormSchema>

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  const octets = host.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [first, second] = octets
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function sendsCredentialsInClear(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' && !isPrivateHost(url.hostname)
  } catch {
    return false
  }
}

function buildDefaultValues(server?: OpenCodeServer | null): ServerFormValues {
  return {
    name: server?.name ?? '',
    baseUrl: server?.baseUrl ?? '',
    username: server?.username ?? OPENCODE_SERVER_USERNAME,
    password: '',
    enabled: server?.enabled ?? true,
  }
}

function TestResultSummary({ result }: { result: OpenCodeServerTestResult }) {
  if (!result.ok) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="break-words">{result.error ?? 'Connection failed'}</span>
      </div>
    )
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      <span>Connected — OpenCode {result.version ?? 'unknown version'}</span>
      {result.versionSupported ? (
        <Badge variant="secondary">Supported</Badge>
      ) : (
        <Badge variant="destructive">Unsupported version</Badge>
      )}
    </div>
  )
}

export function OpenCodeServerDialog({
  open,
  onOpenChange,
  server,
  onSubmit,
  onTest,
}: OpenCodeServerDialogProps) {
  const form = useForm<ServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: buildDefaultValues(server),
  })
  const [pairingLink, setPairingLink] = useState<OpenCodeServerLink | null>(null)
  const [linkInput, setLinkInput] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [clearPassword, setClearPassword] = useState(false)
  const [testResult, setTestResult] = useState<OpenCodeServerTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.reset(buildDefaultValues(server))
    setPairingLink(null)
    setLinkInput('')
    setLinkError(null)
    setClearPassword(false)
    setTestResult(null)
    setTestError(null)
  }, [open, server, form])

  const baseUrlValue = form.watch('baseUrl')
  const transportWarning = sendsCredentialsInClear(baseUrlValue)
  const isEditing = Boolean(server)
  const isSubmitting = form.formState.isSubmitting

  const applyPairingLink = (text: string) => {
    const link = parseOpenCodeServerLink(text)
    if (!link) {
      const version = readOpenCodeServerLinkVersion(text)
      setLinkError(version !== null && version !== OPENCODE_SERVER_LINK_VERSION
        ? `This pairing link uses link version ${version}, but this Manager expects version ${OPENCODE_SERVER_LINK_VERSION}. Update the Manager or the ocm CLI and generate a new QR code.`
        : 'That is not a valid OpenCode pairing link.')
      return
    }
    setPairingLink(link)
    setLinkInput(text.trim())
    setLinkError(null)
    setTestResult(null)
    setTestError(null)
    form.setValue('name', link.name, { shouldValidate: true })
    form.setValue('baseUrl', link.baseUrl, { shouldValidate: true })
  }

  const clearPairing = () => {
    setPairingLink(null)
    setLinkInput('')
    setLinkError(null)
  }

  const collectValues = (): OpenCodeServerFormValues => ({
    ...form.getValues(),
    clearPassword,
    pairing: pairingLink?.pairing ?? null,
  })

  const handleTest = async () => {
    const isValid = await form.trigger(['baseUrl', 'username'])
    if (!isValid) return
    setIsTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      setTestResult(await onTest(collectValues()))
    } catch (error) {
      setTestError(error instanceof Error ? error.message : 'Connection test failed')
    } finally {
      setIsTesting(false)
    }
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await onSubmit({ ...values, clearPassword, pairing: pairingLink?.pairing ?? null })
      onOpenChange(false)
    } catch (error) {
      form.setError('root', {
        message: error instanceof Error ? error.message : 'Failed to save the server',
      })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="border-b p-4 sm:p-6">
          <DialogTitle>{isEditing ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            Link a remote OpenCode server so its sessions appear in this Manager.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Form {...form}>
            <div className="space-y-4">
              {!isEditing && (
                <section className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Pair from QR code</p>
                      <p className="text-xs text-muted-foreground">
                        Scan the code shown by the server, or paste its pairing link.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsScannerOpen(true)}>
                      <ScanLine className="mr-2 h-4 w-4" />
                      Scan QR
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pairing-link">Pairing link</Label>
                    <Textarea
                      id="pairing-link"
                      value={linkInput}
                      onChange={(event) => {
                        setLinkInput(event.target.value)
                        setLinkError(null)
                      }}
                      placeholder={`ocm://link?v=${OPENCODE_SERVER_LINK_VERSION}&kind=opencode&...`}
                      rows={2}
                      className="font-mono"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyPairingLink(linkInput)}
                        disabled={!linkInput.trim()}
                      >
                        Use link
                      </Button>
                      {pairingLink && (
                        <>
                          <Badge variant="secondary">Pairing with {pairingLink.name}</Badge>
                          <Button type="button" variant="ghost" size="sm" onClick={clearPairing}>
                            Clear
                          </Button>
                        </>
                      )}
                    </div>
                    {linkError && (
                      <p role="alert" className="text-sm text-destructive">
                        {linkError}
                      </p>
                    )}
                  </div>
                </section>
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Kitchen workstation" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://opencode.example.com" className="font-mono" />
                    </FormControl>
                    <FormDescription>The base URL of the remote OpenCode server.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {transportWarning && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 p-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This URL is not HTTPS, so credentials travel unencrypted. Use HTTPS unless the server is on a
                    private network.
                  </span>
                </div>
              )}

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="username" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!pairingLink && (
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            disabled={clearPassword}
                            placeholder={isEditing ? 'Leave blank to keep the current password' : 'Server password'}
                          />
                        </FormControl>
                        <FormDescription>
                          {isEditing
                            ? 'Leave blank to keep the current password.'
                            : 'Password used to authenticate with the remote server.'}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {isEditing && server?.hasPassword && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="clear-password"
                        checked={clearPassword}
                        onCheckedChange={(checked) => setClearPassword(checked === true)}
                      />
                      <Label htmlFor="clear-password" className="font-normal">
                        Clear stored password
                      </Label>
                    </div>
                  )}
                </div>
              )}

              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Enabled</FormLabel>
                      <FormDescription>Connect to this server when the Manager starts.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Enabled" />
                    </FormControl>
                  </FormItem>
                )}
              />

              {!pairingLink && (
                <div className="space-y-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
                    {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Test connection
                  </Button>
                  {testResult && <TestResultSummary result={testResult} />}
                  {testError && (
                    <p role="alert" className="text-sm text-destructive">
                      {testError}
                    </p>
                  )}
                </div>
              )}

              {form.formState.errors.root?.message && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
            </div>
          </Form>
        </div>

        <DialogFooter className="gap-2 border-t p-3 pb-4 sm:p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting} className="flex-1 sm:flex-none">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Save changes' : 'Add server'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <QrCodeScanner open={isScannerOpen} onOpenChange={setIsScannerOpen} onResult={applyPairingLink} />
    </Dialog>
  )
}
