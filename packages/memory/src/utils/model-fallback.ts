export function parseModelString(modelStr?: string): { providerID: string; modelID: string } | undefined {
  if (!modelStr) return undefined
  const slashIndex = modelStr.indexOf('/')
  if (slashIndex <= 0 || slashIndex === modelStr.length - 1) return undefined
  return {
    providerID: modelStr.substring(0, slashIndex),
    modelID: modelStr.substring(slashIndex + 1),
  }
}

export async function retryWithModelFallback<T>(
  callWithModel: () => Promise<{ data?: T; error?: unknown }>,
  callWithoutModel: () => Promise<{ data?: T; error?: unknown }>,
  model: { providerID: string; modelID: string } | undefined,
  logger: { error: (msg: string, err?: unknown) => void; log: (msg: string) => void },
  maxRetries: number = 2
): Promise<{ result: { data?: T; error?: unknown }; usedModel: { providerID: string; modelID: string } | undefined }> {
  if (!model) {
    return { result: await callWithoutModel(), usedModel: undefined }
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await callWithModel()
    if (!result.error) {
      return { result, usedModel: model }
    }
    lastError = result.error
    if (attempt < maxRetries) {
      logger.log(`model attempt ${attempt}/${maxRetries} failed, retrying`)
    } else {
      logger.log(`model attempt ${attempt}/${maxRetries} failed`)
    }
  }

  logger.error(`configured model unavailable after ${maxRetries} attempts, falling back to default`, lastError)
  return { result: await callWithoutModel(), usedModel: undefined }
}
