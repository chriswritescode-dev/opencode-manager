#!/usr/bin/env bun
import { execSync } from 'child_process'

const PORTS = {
  backend: [5001, 5002, 5003],
  frontend: [5173, 5174, 5175, 5176],
  opencode: [5551],
  whisper: [5552],
  chatterbox: [5553],
}

const ALL_PORTS = Object.values(PORTS).flat()

interface ProcessInfo {
  pid: number
  port: number
  command: string
  service: string
}

function findProcessesOnPorts(): ProcessInfo[] {
  const processes: ProcessInfo[] = []

  for (const port of ALL_PORTS) {
    try {
      const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim()
      if (!output) continue

      const pids = output.split('\n').filter(Boolean).map(p => parseInt(p))
      
      for (const pid of pids) {
        try {
          const cmdOutput = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim()
          const service = getServiceName(port)
          processes.push({ pid, port, command: cmdOutput, service })
        } catch {}
      }
    } catch {}
  }

  return processes
}

function getServiceName(port: number): string {
  for (const [service, ports] of Object.entries(PORTS)) {
    if (ports.includes(port)) return service
  }
  return 'unknown'
}

function killProcess(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
      return true
    } catch {
      return false
    }
  }
}

function printHelp() {
  console.log(`
opencode-manager cleanup

Kills orphaned processes on ports used by opencode-manager.

Usage: bun scripts/cleanup.ts [options]

Options:
  --dry-run, -n   Show what would be killed without actually killing
  --all, -a       Kill all processes on managed ports
  --port, -p      Kill processes on specific port(s), comma-separated
  --help, -h      Show this help message

Managed ports:
  Backend:     ${PORTS.backend.join(', ')}
  Frontend:    ${PORTS.frontend.join(', ')}
  OpenCode:    ${PORTS.opencode.join(', ')}
  Whisper:     ${PORTS.whisper.join(', ')}
  Chatterbox:  ${PORTS.chatterbox.join(', ')}

Examples:
  bun scripts/cleanup.ts              # Interactive cleanup
  bun scripts/cleanup.ts --dry-run    # Show processes without killing
  bun scripts/cleanup.ts --all        # Kill all managed processes
  bun scripts/cleanup.ts -p 5552,5553 # Kill specific ports
`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    dryRun: args.includes('--dry-run') || args.includes('-n'),
    all: args.includes('--all') || args.includes('-a'),
    help: args.includes('--help') || args.includes('-h'),
    ports: (() => {
      const idx = args.findIndex(a => a === '--port' || a === '-p')
      if (idx === -1 || !args[idx + 1]) return null
      return args[idx + 1].split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p))
    })(),
  }
}

async function main() {
  const args = parseArgs()

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  console.log('\n🧹 OpenCode Manager Cleanup\n')

  const processes = findProcessesOnPorts()

  if (processes.length === 0) {
    console.log('✓ No processes found on managed ports. All clean!\n')
    process.exit(0)
  }

  const filtered = args.ports 
    ? processes.filter(p => args.ports!.includes(p.port))
    : processes

  if (filtered.length === 0) {
    console.log('✓ No processes found on specified ports.\n')
    process.exit(0)
  }

  console.log('Found processes:\n')
  for (const proc of filtered) {
    console.log(`  [${proc.service}] Port ${proc.port} - PID ${proc.pid} (${proc.command})`)
  }
  console.log('')

  if (args.dryRun) {
    console.log('Dry run - no processes killed.\n')
    process.exit(0)
  }

  if (!args.all && !args.ports) {
    const readline = await import('readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    
    const answer = await new Promise<string>(resolve => {
      rl.question('Kill these processes? [y/N]: ', resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'y') {
      console.log('\nAborted.\n')
      process.exit(0)
    }
  }

  console.log('\nKilling processes...\n')

  let killed = 0
  let failed = 0

  for (const proc of filtered) {
    const success = killProcess(proc.pid)
    if (success) {
      console.log(`  ✓ Killed PID ${proc.pid} (${proc.service} on port ${proc.port})`)
      killed++
    } else {
      console.log(`  ✗ Failed to kill PID ${proc.pid}`)
      failed++
    }
  }

  console.log(`\n${killed} killed, ${failed} failed.\n`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
