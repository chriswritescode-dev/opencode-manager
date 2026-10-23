import { useEffect, useRef, useState } from 'react'
import {
  CLOUDFLARE_ACCESS_HEADER_NAMES,
  REMOTE_ACCESS_HEADER_MAX_COUNT,
  RemoteAccessHeaderNameSchema,
  RemoteAccessHeaderValueSchema,
  type RemoteAccessHeaderSummary,
} from '@opencode-manager/shared/schemas'
import { useRemoteAccessHeaders } from '@/hooks/useDevicePairing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { AlertCircle, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'

const STORED_VALUE_PLACEHOLDER = 'Stored – leave blank to keep'

interface HeaderRow {
  id: number
  name: string
  value: string
}

let nextRowIdValue = 0

function nextRowId(): number {
  nextRowIdValue += 1
  return nextRowIdValue
}

function createRows(summaries: RemoteAccessHeaderSummary[]): HeaderRow[] {
  return summaries.map((header) => ({
    id: nextRowId(),
    name: header.name,
    value: '',
  }))
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function hasStoredValue(storedNames: Set<string>, name: string): boolean {
  return storedNames.has(normalizeName(name))
}

function rowNameError(row: HeaderRow): string | null {
  const parsed = RemoteAccessHeaderNameSchema.safeParse(row.name)
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid header name'
}

function rowValueError(row: HeaderRow, stored: boolean): string | null {
  if (stored && row.value.trim() === '') return null
  const parsed = RemoteAccessHeaderValueSchema.safeParse(row.value)
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid header value'
}

function isRowValid(row: HeaderRow, stored: boolean): boolean {
  return RemoteAccessHeaderNameSchema.safeParse(row.name).success && rowValueError(row, stored) === null
}

export function RemoteAccessHeadersSettings() {
  const { headers, unreadable, isLoading, replace, clear, isSaving } = useRemoteAccessHeaders()
  const [rows, setRows] = useState<HeaderRow[]>(() => (isLoading ? [] : createRows(headers)))
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const initialized = useRef(!isLoading)

  useEffect(() => {
    if (initialized.current || isLoading) return
    initialized.current = true
    setRows(createRows(headers))
  }, [headers, isLoading])

  const storedNames = new Set(headers.map((header) => normalizeName(header.name)))
  const rowsAreValid = rows.every((row) => isRowValid(row, hasStoredValue(storedNames, row.name)))
  const atMaxCount = rows.length >= REMOTE_ACCESS_HEADER_MAX_COUNT

  const handleAdd = () => {
    setRows((current) => [...current, { id: nextRowId(), name: '', value: '' }])
  }

  const handleCloudflarePreset = () => {
    setRows((current) => {
      const existingNames = new Set(current.map((row) => normalizeName(row.name)))
      const missingNames = CLOUDFLARE_ACCESS_HEADER_NAMES.filter(
        (name) => !existingNames.has(normalizeName(name)),
      )
      const availableSlots = REMOTE_ACCESS_HEADER_MAX_COUNT - current.length
      return [
        ...current,
        ...missingNames.slice(0, Math.max(availableSlots, 0)).map((name) => ({
          id: nextRowId(),
          name,
          value: '',
        })),
      ]
    })
  }

  const handleRemove = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  const handleNameChange = (index: number, name: string) => {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, name } : row)),
    )
  }

  const handleValueChange = (index: number, value: string) => {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, value } : row)),
    )
  }

  const handleSave = async () => {
    setError(null)
    if (!rowsAreValid) return

    try {
      const response = await replace.mutateAsync({
        headers: rows.map((row) => ({
          name: row.name.trim(),
          value: row.value.trim() === '' ? undefined : row.value.trim(),
        })),
      })
      setRows(createRows(response.headers))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save remote access headers')
    }
  }

  const handleClear = async () => {
    setError(null)
    setConfirmClear(false)

    try {
      const response = await clear.mutateAsync()
      setRows(createRows(response.headers))
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear remote access headers')
    }
  }

  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <KeyRound className="h-4 w-4 sm:h-5 sm:w-5" />
          Remote access headers
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Sent by the mobile app on every request, so it can pass a reverse proxy such as Cloudflare Access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        {unreadable && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Stored headers could not be decrypted (AUTH_SECRET may have changed). Enter them again.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-xs sm:text-sm text-muted-foreground">
                No remote access headers are stored.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((row, index) => {
                  const stored = hasStoredValue(storedNames, row.name)
                  const nameError = row.name.trim() === '' ? null : rowNameError(row)
                  const valueError = row.name.trim() === '' ? null : rowValueError(row, stored)

                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <Input
                            value={row.name}
                            onChange={(event) => handleNameChange(index, event.target.value)}
                            placeholder="Header name"
                            aria-label={`Header ${index + 1} name`}
                            className="h-9 font-mono md:text-sm"
                            disabled={isSaving}
                          />
                          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <Input
                            type="password"
                            autoComplete="off"
                            value={row.value}
                            onChange={(event) => handleValueChange(index, event.target.value)}
                            placeholder={stored ? STORED_VALUE_PLACEHOLDER : 'Value'}
                            aria-label={`Header ${index + 1} value`}
                            className="h-9 font-mono md:text-sm"
                            disabled={isSaving}
                          />
                          {valueError && <p className="text-xs text-destructive">{valueError}</p>}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemove(index)}
                          aria-label={`Remove header ${index + 1}`}
                          className="h-9 w-9 shrink-0"
                          disabled={isSaving}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAdd}
                disabled={isSaving || atMaxCount}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add header
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCloudflarePreset}
                disabled={isSaving || atMaxCount}
              >
                Cloudflare Access service token
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !rowsAreValid}
              >
                {replace.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={isSaving || rows.length === 0}
              >
                Clear all
              </Button>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Cloudflare Access: create a service token in Zero Trust, add a Service Auth policy for it
          on the Manager&apos;s Access application, then paste its Client ID and Client Secret here.
        </p>
      </CardContent>

      <DeleteDialog
        open={confirmClear}
        onOpenChange={(open) => !open && setConfirmClear(false)}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
        title="Clear Remote Access Headers"
        description="The mobile app will stop sending these headers on every request."
        isDeleting={clear.isPending}
      />
    </Card>
  )
}
