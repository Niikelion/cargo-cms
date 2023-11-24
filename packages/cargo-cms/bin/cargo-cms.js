#! /usr/bin/env node

if (!Boolean(process.env.CARGO_DEV)) {
    require("../dist/index.js")
    return
}

const path = require("path")
const spawn = require('child_process').spawn
const p = path.resolve(__dirname, "../src/index.ts")

const program = spawn("ts-node-esm", [p], {shell: true})

program.stdout.pipe(process.stdout)
program.stderr.pipe(process.stderr)
process.stdin.pipe(program.stdin)
process.on('SIGINT', () => program.kill('SIGINT'))