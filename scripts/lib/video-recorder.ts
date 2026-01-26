import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync } from 'fs'
import { join } from 'path'

export function hasFfmpeg(): boolean {
  try {
    const result = spawnSync('which', ['ffmpeg'], { stdio: 'pipe' })
    return result.status === 0
  } catch {
    return false
  }
}

interface Screenshot {
  path: string
  name: string
  timestamp: number
}

interface VideoRecorderOptions {
  width?: number
  height?: number
  fps?: number
  maxScreenshots?: number
  outputName?: string
}

interface CreateVideoResult {
  success: boolean
  videoPath?: string
  error?: string
  size?: number
  sizeMB?: number
  duration?: number
  frameCount?: number
  screenshotCount?: number
}

export class VideoRecorder {
  private testDir: string
  private screenshotsDir: string
  private framesDir: string
  private options: Required<VideoRecorderOptions>
  private screenshots: Screenshot[] = []
  private frameCount = 0

  constructor(testDir: string, options: VideoRecorderOptions = {}) {
    this.testDir = testDir
    this.screenshotsDir = join(testDir, 'screenshots')
    this.framesDir = join(testDir, 'gif-frames')

    this.options = {
      width: options.width || 800,
      height: options.height || 500,
      fps: options.fps || 0.5,
      maxScreenshots: options.maxScreenshots || 30,
      outputName: options.outputName || 'test-recording.gif'
    }
  }

  addScreenshot(screenshotPath: string, name: string, metadata: { timestamp?: number } = {}): void {
    this.screenshots.push({
      path: screenshotPath,
      name,
      timestamp: metadata.timestamp || Date.now()
    })
  }

  collectScreenshots(): void {
    if (!existsSync(this.screenshotsDir)) {
      console.warn(`Screenshots directory not found: ${this.screenshotsDir}`)
      return
    }

    const files = readdirSync(this.screenshotsDir)
      .filter(f => f.endsWith('.png'))
      .sort()

    for (const file of files) {
      const filePath = join(this.screenshotsDir, file)
      const stats = statSync(filePath)
      const name = file.replace(/^\d+_/, '').replace(/\.png$/, '')

      this.addScreenshot(filePath, name, {
        timestamp: stats.mtime.getTime()
      })
    }

    console.log(`Collected ${this.screenshots.length} screenshots`)
  }

  private sampleScreenshots(): Screenshot[] {
    if (this.screenshots.length <= this.options.maxScreenshots) {
      return this.screenshots
    }

    const sampled = [this.screenshots[0]]
    const step = (this.screenshots.length - 1) / (this.options.maxScreenshots - 1)

    for (let i = 1; i < this.options.maxScreenshots - 1; i++) {
      const index = Math.round(i * step)
      sampled.push(this.screenshots[index])
    }

    sampled.push(this.screenshots[this.screenshots.length - 1])

    console.log(`Sampled ${sampled.length} from ${this.screenshots.length} screenshots`)
    return sampled
  }

  async createVideo(): Promise<CreateVideoResult> {
    if (!hasFfmpeg()) {
      return {
        success: false,
        error: 'ffmpeg not found. Install with: brew install ffmpeg'
      }
    }

    if (this.screenshots.length === 0) {
      this.collectScreenshots()
    }

    if (this.screenshots.length === 0) {
      return {
        success: false,
        error: 'No screenshots to create GIF from'
      }
    }

    if (existsSync(this.framesDir)) {
      rmSync(this.framesDir, { recursive: true })
    }
    mkdirSync(this.framesDir, { recursive: true })

    const screenshotsToUse = this.sampleScreenshots()

    for (const screenshot of screenshotsToUse) {
      if (!existsSync(screenshot.path)) {
        console.warn(`Screenshot not found: ${screenshot.path}`)
        continue
      }

      const framePath = join(this.framesDir, `frame_${String(this.frameCount).padStart(5, '0')}.png`)

      const scaleResult = spawnSync('ffmpeg', [
        '-y',
        '-i', screenshot.path,
        '-vf', `scale=${this.options.width}:${this.options.height}:force_original_aspect_ratio=decrease,pad=${this.options.width}:${this.options.height}:(ow-iw)/2:(oh-ih)/2:white`,
        '-frames:v', '1',
        framePath
      ], { stdio: 'pipe' })

      if (scaleResult.status !== 0) {
        copyFileSync(screenshot.path, framePath)
      }

      this.frameCount++
    }

    console.log(`Created ${this.frameCount} frames from ${screenshotsToUse.length} screenshots`)

    const outputPath = join(this.testDir, this.options.outputName)
    const palettePath = join(this.framesDir, 'palette.png')

    const paletteResult = spawnSync('ffmpeg', [
      '-y',
      '-framerate', String(this.options.fps),
      '-i', join(this.framesDir, 'frame_%05d.png'),
      '-vf', 'palettegen=stats_mode=diff',
      palettePath
    ], { stdio: 'pipe' })

    if (paletteResult.status !== 0) {
      console.log('Palette generation failed, using single-pass')
      const simpleResult = spawnSync('ffmpeg', [
        '-y',
        '-framerate', String(this.options.fps),
        '-i', join(this.framesDir, 'frame_%05d.png'),
        '-vf', `scale=${this.options.width}:-1:flags=lanczos`,
        outputPath
      ], { stdio: 'pipe' })

      if (simpleResult.status !== 0) {
        const stderr = simpleResult.stderr?.toString() || 'Unknown error'
        try { rmSync(this.framesDir, { recursive: true }) } catch {}
        return {
          success: false,
          error: `ffmpeg failed: ${stderr.substring(0, 500)}`
        }
      }
    } else {
      const gifResult = spawnSync('ffmpeg', [
        '-y',
        '-framerate', String(this.options.fps),
        '-i', join(this.framesDir, 'frame_%05d.png'),
        '-i', palettePath,
        '-lavfi', 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
        outputPath
      ], { stdio: 'pipe' })

      if (gifResult.status !== 0) {
        const stderr = gifResult.stderr?.toString() || 'Unknown error'
        try { rmSync(this.framesDir, { recursive: true }) } catch {}
        return {
          success: false,
          error: `ffmpeg GIF creation failed: ${stderr.substring(0, 500)}`
        }
      }
    }

    try {
      rmSync(this.framesDir, { recursive: true })
    } catch {}

    const stats = statSync(outputPath)
    const sizeMB = parseFloat((stats.size / 1024 / 1024).toFixed(2))
    const durationSec = this.frameCount / this.options.fps

    console.log(`GIF created: ${outputPath}`)
    console.log(`  Size: ${sizeMB} MB`)
    console.log(`  Duration: ${durationSec} seconds`)
    console.log(`  Frames: ${this.frameCount}`)

    return {
      success: true,
      videoPath: outputPath,
      size: stats.size,
      sizeMB,
      duration: durationSec,
      frameCount: this.frameCount,
      screenshotCount: this.screenshots.length
    }
  }

  static async fromTestDirectory(testDir: string, options: VideoRecorderOptions = {}): Promise<CreateVideoResult> {
    const recorder = new VideoRecorder(testDir, options)
    recorder.collectScreenshots()
    return recorder.createVideo()
  }
}

export default VideoRecorder
