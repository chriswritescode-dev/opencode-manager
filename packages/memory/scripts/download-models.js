import { mkdirSync, existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'

const xdgDataHome = process.env['XDG_DATA_HOME'] || join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
const cacheDir = join(xdgDataHome, 'opencode', 'memory', 'models')

if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true })
}

async function downloadModel(modelName) {
  console.log(`Downloading model: ${modelName}...`)
  const { env, pipeline } = await import('@huggingface/transformers')
  env.cacheDir = cacheDir
  await pipeline('feature-extraction', modelName, { dtype: 'fp32' })
  console.log(`Downloaded: ${modelName}`)
}

async function main() {
  console.log(`Cache directory: ${cacheDir}`)

  const models = [
    'sentence-transformers/all-MiniLM-L6-v2',
  ]

  for (const model of models) {
    try {
      await downloadModel(model)
    } catch (error) {
      console.error(`Failed to download ${model}:`, error.message)
    }
  }

  console.log('Model download complete.')
}

main()
