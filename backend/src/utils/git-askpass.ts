#!/usr/bin/env bun

import { exit } from 'process'
import { logger } from './logger'

// Called by Git as GIT_ASKPASS script
// Arg: prompt like "Password for 'https://github.com': "
// Returns: token or empty string

const prompt = process.argv[2] || ''

if (!prompt) {
  exit(1)
}

try {
  const response = await fetch('http://localhost:5001/git/askpass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      cwd: process.cwd()
    })
  })

  if (!response.ok) {
    logger.error('Askpass request failed')
    console.log('')
    exit(1)
  }

  const result = await response.json() as { token?: string }
  console.log(result.token || '')
} catch {
  logger.error('Askpass error')
  console.log('')
  exit(1)
}