import fs from 'fs/promises'
import path from 'path'
import { OCRResult } from './ocr-analyzer'

export interface TestResult {
  name: string
  passed: boolean
  duration?: number
  error?: string
  screenshot?: string
  ocrResult?: OCRResult
  notes?: string[]
}

export interface TestSection {
  name: string
  tests: TestResult[]
}

export interface TestReport {
  environment: string
  url: string
  timestamp: string
  duration: number
  sections: TestSection[]
  screenshots: string[]
  ocrResults: string[]
  summary: {
    totalTests: number
    passed: number
    failed: number
    warnings: number
  }
}

export async function generateMarkdownReport(
  report: TestReport,
  outputPath: string
): Promise<void> {
  const lines: string[] = []
  
  lines.push('# OpenCode Manager Production Readiness Test Report')
  lines.push('')
  lines.push(`**Environment:** ${report.environment}`)
  lines.push(`**URL:** ${report.url}`)
  lines.push(`**Timestamp:** ${report.timestamp}`)
  lines.push(`**Total Duration:** ${(report.duration / 1000).toFixed(2)}s`)
  lines.push('')
  
  lines.push('---')
  lines.push('')
  
  lines.push('## Summary')
  lines.push('')
  lines.push(`- **Total Tests:** ${report.summary.totalTests}`)
  lines.push(`- **Passed:** ✅ ${report.summary.passed}`)
  lines.push(`- **Failed:** ❌ ${report.summary.failed}`)
  lines.push(`- **Warnings:** ⚠️ ${report.summary.warnings}`)
  lines.push('')
  
  const successRate = ((report.summary.passed / report.summary.totalTests) * 100).toFixed(1)
  lines.push(`**Success Rate:** ${successRate}%`)
  lines.push('')
  
  lines.push('---')
  lines.push('')
  
  for (const section of report.sections) {
    lines.push(`## ${section.name}`)
    lines.push('')
    
    for (const test of section.tests) {
      const icon = test.passed ? '✅' : '❌'
      const duration = test.duration ? ` (${(test.duration / 1000).toFixed(2)}s)` : ''
      lines.push(`### ${icon} ${test.name}${duration}`)
      lines.push('')
      
      if (test.error) {
        lines.push('**Error:**')
        lines.push('```')
        lines.push(test.error)
        lines.push('```')
        lines.push('')
      }
      
      if (test.notes && test.notes.length > 0) {
        lines.push('**Notes:**')
        for (const note of test.notes) {
          lines.push(`- ${note}`)
        }
        lines.push('')
      }
      
      if (test.screenshot) {
        lines.push('**Screenshot:**')
        lines.push(`![${test.name}](${path.relative(path.dirname(outputPath), test.screenshot)})`)
        lines.push('')
      }
      
      if (test.ocrResult) {
        lines.push('**OCR Analysis:**')
        lines.push(`- Confidence: ${test.ocrResult.confidence.toFixed(1)}%`)
        lines.push(`- Contains User Label: ${test.ocrResult.containsUserLabel ? '✅' : '❌'}`)
        lines.push(`- Contains User Message: ${test.ocrResult.containsUserMessage ? '✅' : '❌'}`)
        lines.push(`- Contains Assistant Label: ${test.ocrResult.containsAssistantLabel ? '✅' : '❌'}`)
        lines.push(`- Contains Response: ${test.ocrResult.containsResponse ? '✅' : '❌'}`)
        if (test.ocrResult.extractedNumbers.length > 0) {
          lines.push(`- Extracted Numbers: ${test.ocrResult.extractedNumbers.join(', ')}`)
        }
        lines.push('')
        lines.push('<details>')
        lines.push('<summary>Full OCR Text</summary>')
        lines.push('')
        lines.push('```')
        lines.push(test.ocrResult.fullText)
        lines.push('```')
        lines.push('</details>')
        lines.push('')
      }
    }
  }
  
  lines.push('---')
  lines.push('')
  lines.push('## All Screenshots')
  lines.push('')
  for (const screenshot of report.screenshots) {
    const basename = path.basename(screenshot)
    lines.push(`### ${basename}`)
    lines.push(`![${basename}](${path.relative(path.dirname(outputPath), screenshot)})`)
    lines.push('')
  }
  
  if (report.ocrResults.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## OCR Results')
    lines.push('')
    for (const ocrFile of report.ocrResults) {
      const basename = path.basename(ocrFile)
      lines.push(`- [${basename}](${path.relative(path.dirname(outputPath), ocrFile)})`)
    }
    lines.push('')
  }
  
  const markdown = lines.join('\n')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, markdown)
}

export function createTestResult(
  name: string,
  passed: boolean,
  options: Partial<TestResult> = {}
): TestResult {
  return {
    name,
    passed,
    ...options,
  }
}
