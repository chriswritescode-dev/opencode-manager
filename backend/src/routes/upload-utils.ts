import { InstallSkillUploadManifestEntrySchema, type InstallSkillUploadManifestEntry } from '@opencode-manager/shared'

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

export async function readUploadedManifestFiles(
  formData: ParsedFormData,
  manifest: InstallSkillUploadManifestEntry[],
): Promise<{ relativePath: string; content: Buffer }[]> {
  const missingFields = manifest.filter((entry) => !formData[entry.fieldName])
  if (missingFields.length > 0) {
    throw new UploadValidationError(`Missing upload file(s): ${missingFields.map((e) => e.fieldName).join(', ')}`)
  }

  return Promise.all(
    manifest.map(async (entry) => {
      const file = formData[entry.fieldName]
      if (!file || !(file instanceof File)) {
        throw new Error(`Field "${entry.fieldName}" is not a valid file`)
      }
      const content = Buffer.from(await file.arrayBuffer())
      return { relativePath: entry.relativePath, content }
    }),
  )
}
