#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');
const { generateReport } = require('../src/report');

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  k6-clean-report <input.json> [options]

Options:
  --output, -o <file>   Output file path (overrides auto-generated name)
  --test   <name>       Test type label (e.g. load, smoke, stress)
  --env    <name>       Environment label (e.g. dev, staging, prod)
  --target <url>        System under test URL (e.g. https://api.example.com)
  --help,  -h           Show this help

Examples:
  k6-clean-report results/load-dev-20260505.json
  k6-clean-report results/load-dev-20260505.json --output report.html
  k6-clean-report results/load-dev-20260505.json --test load --env staging

Auto-generated filename format:
  <test>-<env>-<UTC timestamp>-performance-report.html
  e.g. load-staging-20260505102345-performance-report.html
`);
  process.exit(0);
}

const inputFile = args[0];
let outputFile  = null;
let testName    = null;
let env         = null;
let target      = null;

for (let i = 1; i < args.length; i++) {
  if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
    outputFile = args[++i];
  } else if (args[i] === '--test' && args[i + 1]) {
    testName = args[++i];
  } else if (args[i] === '--env' && args[i + 1]) {
    env = args[++i];
  } else if (args[i] === '--target' && args[i + 1]) {
    target = args[++i];
  }
}

function utcTimestamp() {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function guessTestName(filePath) {
  const base = path.basename(filePath, '.json');
  const parts = base.split(/[-_]/);
  const known = ['smoke', 'load', 'stress', 'soak', 'spike', 'breakpoint'];
  return parts.find(p => known.includes(p.toLowerCase())) || parts[0] || 'test';
}

function guessEnv(filePath) {
  const base = path.basename(filePath, '.json');
  const parts = base.split(/[-_]/);
  const known = ['dev', 'staging', 'prod', 'production', 'local'];
  return parts.find(p => known.includes(p.toLowerCase())) || 'dev';
}

if (!fs.existsSync(inputFile)) {
  console.error(`Error: file not found: ${inputFile}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
} catch (e) {
  console.error(`Error: could not parse JSON: ${e.message}`);
  process.exit(1);
}

const resolvedTest = testName || guessTestName(inputFile);
const resolvedEnv  = env      || guessEnv(inputFile);

if (!outputFile) {
  outputFile = `${resolvedTest}-${resolvedEnv}-${utcTimestamp()}-performance-report.html`;
}

const html = generateReport(data, { testName: resolvedTest, env: resolvedEnv, target });
fs.writeFileSync(outputFile, html, 'utf8');
console.log(`Report written to: ${path.resolve(outputFile)}`);
