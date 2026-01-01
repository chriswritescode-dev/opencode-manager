#!/usr/bin/env node
const pty = require('node-pty');
const readline = require('readline');

const shell = process.env.PTY_SHELL || '/bin/bash';
const cwd = process.env.PTY_CWD || process.env.HOME || '/tmp';
const cols = parseInt(process.env.PTY_COLS || '80', 10);
const rows = parseInt(process.env.PTY_ROWS || '24', 10);

let ptyProcess;

try {
  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  console.log(JSON.stringify({ type: 'started', pid: ptyProcess.pid }));

  ptyProcess.onData((data) => {
    // Escape any newlines in the data string itself to ensure one JSON object per line
    console.log(JSON.stringify({ type: 'data', data }));
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    process.stdout.write(JSON.stringify({ type: 'exit', exitCode, signal }) + '\n', () => {
      process.exit(0);
    });
  });

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case 'input':
          if (msg.data) ptyProcess.write(msg.data);
          break;
        case 'resize':
          if (msg.cols && msg.rows) ptyProcess.resize(msg.cols, msg.rows);
          break;
        case 'kill':
          ptyProcess.kill();
          process.exit(0);
          break;
      }
    } catch (e) {
      console.log(JSON.stringify({ type: 'error', error: e.message }));
    }
  });

  rl.on('close', () => {
    if (ptyProcess) ptyProcess.kill();
    process.exit(0);
  });

} catch (error) {
  console.log(JSON.stringify({ type: 'error', error: error.message }));
  process.exit(1);
}
