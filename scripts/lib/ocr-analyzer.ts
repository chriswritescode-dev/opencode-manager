import { createWorker } from 'tesseract.js'
import fs from 'fs/promises'
import path from 'path'

export interface OCRResult {
  imagePath: string
  fullText: string
  confidence: number
  containsUserLabel: boolean
  containsAssistantLabel: boolean
  containsUserMessage: boolean
  containsResponse: boolean
  extractedNumbers: string[]
  timestamp: string
}

export interface OCRConfig {
  language?: string
  minConfidence?: number
}

const DEFAULT_CONFIG: OCRConfig = {
  language: 'eng',
  minConfidence: 70,
}

export async function analyzeScreenshot(
  imagePath: string,
  config: OCRConfig = DEFAULT_CONFIG
): Promise<OCRResult> {
  const worker = await createWorker()
  
  try {
    await worker.loadLanguage(config.language || 'eng')
    await worker.initialize(config.language || 'eng')
    
    const { data } = await worker.recognize(imagePath)
    
    const fullText = data.text
    const confidence = data.confidence
    
    const containsUserLabel = 
      fullText.toLowerCase().includes('you') ||
      fullText.toLowerCase().includes('user')
    
    const containsAssistantLabel =
      fullText.toLowerCase().includes('assistant') ||
      fullText.toLowerCase().includes('ai')
    
    const containsUserMessage =
      fullText.toLowerCase().includes('what is two') ||
      fullText.toLowerCase().includes('2 plus 2') ||
      fullText.toLowerCase().includes('plus two')
    
    const numberMatches = fullText.match(/\d+/g) || []
    const containsResponse = numberMatches.length > 0
    
    return {
      imagePath,
      fullText,
      confidence,
      containsUserLabel,
      containsAssistantLabel,
      containsUserMessage,
      containsResponse,
      extractedNumbers: numberMatches,
      timestamp: new Date().toISOString(),
    }
  } finally {
    await worker.terminate()
  }
}

export async function saveOCRResult(result: OCRResult, outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2))
}

export async function analyzeTalkModeCaptions(
  screenshotPath: string,
  config: OCRConfig = DEFAULT_CONFIG
): Promise<{
  result: OCRResult
  passed: boolean
  reasons: string[]
}> {
  const result = await analyzeScreenshot(screenshotPath, config)
  
  const reasons: string[] = []
  let passed = true
  
  if (result.confidence < (config.minConfidence || 70)) {
    passed = false
    reasons.push(`Low OCR confidence: ${result.confidence.toFixed(1)}% (min: ${config.minConfidence}%)`)
  }
  
  if (!result.containsUserLabel) {
    reasons.push('User label not found in screenshot')
  }
  
  if (!result.containsUserMessage) {
    reasons.push('User message text not found in screenshot')
  }
  
  if (!result.containsAssistantLabel) {
    reasons.push('Assistant label not found in screenshot (may be expected for local tests)')
  }
  
  if (!result.containsResponse) {
    reasons.push('No response numbers found in screenshot (may be expected for local tests)')
  }
  
  return {
    result,
    passed: passed && result.containsUserLabel && result.containsUserMessage,
    reasons,
  }
}
