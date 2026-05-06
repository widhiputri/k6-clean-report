# k6-clean-report

Generate clean, readable HTML reports from [k6](https://k6.io) performance test JSON output. Designed for sharing results with non-technical stakeholders.

## Install

```bash
npm install -g k6-clean-report
```

Or as a project dev dependency:

```bash
npm install --save-dev k6-clean-report
```

## Quick Start

**Step 1:** Export k6 results to JSON by adding this to your `handleSummary` function:

```js
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'k6-results.json': JSON.stringify(data),
  };
}
```

**Step 2:** Generate the report after your test runs:

```bash
k6-clean-report k6-results.json --test load --env staging
```

This produces a self-contained HTML file: `load-staging-20260506102345-performance-report.html`

## CLI Options

```
k6-clean-report <input.json> [options]

Options:
  --test   <name>   Test type label: smoke, load, stress, soak, spike, breakpoint
  --env    <name>   Environment label: dev, staging, prod
  --target <url>    URL of the system under test
  --output <file>   Output file path (overrides auto-generated name)
  --help            Show help
```

If `--test` or `--env` are not provided, the tool attempts to guess them from the input filename.

## Node.js API

```js
const { generateReport } = require('k6-clean-report');
const fs   = require('fs');
const data = JSON.parse(fs.readFileSync('k6-results.json', 'utf8'));

const html = generateReport(data, {
  testName: 'load',
  env: 'staging',
  target: 'https://api.example.com',
});

fs.writeFileSync('report.html', html);
```

## What the Report Shows

| Section | What it contains |
|---|---|
| Executive Summary | Pass/fail verdict, error rate, failing goals |
| Test Configuration | Environment, target URL, duration, RPS, iterations |
| Performance Goals | All thresholds with PASS/FAIL status |
| At a Glance | 95th percentile bar chart by scenario or page (if tagged) |
| Response Times | Min, average, median, 90th/95th/99th percentile |
| Request Time Breakdown | Time spent per phase: queued, connecting, TLS, sending, waiting, receiving |
| Iteration and Group Timing | Full iteration duration and named group() durations |
| Breakdown by Scenario / Page | Per-scenario response times and error rates (if tagged) |
| Application Metrics | Custom metrics defined in your test script |
| Detailed Metrics | All metrics with full statistics, grouped by type |
| Quality Checks | All check() results with pass/fail counts |

The report is fully self-contained (no CDN dependencies) and print-ready.

## Scenario and Page Breakdown

The "At a Glance" and "Breakdown by Scenario / Page" sections appear automatically when your test uses tagged requests:

```js
// Multiple named scenarios (k6 options)
export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 10, duration: '5m' },
    checkout: { executor: 'constant-vus', vus: 5, duration: '5m' },
  },
};

// Or tagged requests
http.get(url, { tags: { page: 'homepage' } });
http.post(url, body, { tags: { page: 'checkout' } });
```

## Custom Metrics

Custom metrics defined in your test script appear in the "Application Metrics" section:

```js
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

const checkoutDuration = new Trend('checkout_duration');
const loginSuccessRate = new Rate('login_success_rate');
```

## Chaining with npm Scripts

```json
{
  "scripts": {
    "test:load": "k6 run script.js && k6-clean-report k6-results.json --test load --env staging --target https://api.example.com"
  }
}
```

## License

MIT
