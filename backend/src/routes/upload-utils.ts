import { InstallSkillUploadManifestEntrySchema, type InstallSkillUploadManifestEntry } from '@opencode-manager/shared'
import type { Context } from 'hono'

export class UploadValidationError extends Error {}

type ParsedFormData = Record<string, unknown>

export function parseUploadManifest(fileManifestRaw: unknown): InstallSkillUploadManifestEntry[] {
  if (typeof fileManifestRaw !== 'string') {
    throw new UploadValidationError('fileManifest is required as a JSON string')
  }

  let manifestEntries: unknown
  try {
    manifestEntries = JSON.parse(fileManifestRaw)
  } catch {
    throw new UploadValidationError('fileManifest must be valid JSON')
  }

  return InstallSkillUploadManifestEntrySchema.array().parse(manifestEntries)
}

export async function parseUploadPreamble(c: Context): Promise<{ formData: ParsedFormData; manifest: InstallSkillUploadManifestEntry[] }> {
  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    throw new UploadValidationError('Unsupported content type. Use multipart/form-data')
  }

  const formData = await c.req.parseBody({ all: true })
  const manifest = parseUploadManifest(formData['fileManifest'])

  return { formData, manifest }
}

export const UPLOAD_PATH_ERROR_STATUS: ReadonlyArray<readonly [string, 400]> = [
  ['Path must be relative', 400],
  ['Path must not be empty', 400],
  ['Path must not contain', 400],
  ['escapes', 400],
  ['not a valid file', 400],
]

export function resolveUploadedManifestFiles(
  formData: ParsedFormData,
  manifest: InstallSkillUploadManifestEntry[],
): { relativePath: string; file: File }[] {
  const missingFields = manifest.filter((entry) => !formData[entry.fieldName])
  if (missingFields.length > 0) {
    throw new UploadValidationError(`Missing upload file(s): ${missingFields.map((e) => e.fieldName).join(', ')}`)
  }

  return manifest.map((entry) => {
    const file = formData[entry.fieldName]
    if (!file || !(file instanceof File)) {
      throw new Error(`Field "${entry.fieldName}" is not a valid file`)
    }
    return { relativePath: entry.relativePath, file }
  })
}

export async function readUploadedManifestFiles(
  formData: ParsedFormData,
  manifest: InstallSkillUploadManifestEntry[],
): Promise<{ relativePath: string; content: Buffer }[]> {
  const files = resolveUploadedManifestFiles(formData, manifest)
  return Promise.all(
    files.map(async ({ relativePath, file }) => ({
      relativePath,
      content: Buffer.from(await file.arrayBuffer()),
    })),
  )
}
