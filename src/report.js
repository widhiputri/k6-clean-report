'use strict';

function generateReport(data, options = {}) {
  const testName = options.testName || 'test';
  const env      = options.env      || 'dev';
  const target   = options.target   || 'https://test.k6.io';

  const metrics   = data.metrics;
  const rootGroup = data.root_group;
  const testDurationMs = data.state && data.state.testRunDurationMs;

  const thresholds = {};
  Object.entries(metrics || {}).forEach(([metricName, metric]) => {
    if (metric.thresholds) {
      Object.entries(metric.thresholds).forEach(([condition, result]) => {
        thresholds[`${metricName}:${condition}`] = { ok: result.ok, metric: metricName, condition };
      });
    }
  });

  const _d      = new Date();
  const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now     = _months[_d.getUTCMonth()] + ' ' + _d.getUTCDate() + ', ' + _d.getUTCFullYear()
                + ' at ' + _d.toISOString().substring(11, 19) + ' UTC';

  const allPassed = Object.values(thresholds).every(t => t.ok !== false);
  const verdict   = allPassed ? 'PASSED' : 'FAILED';

  function val(name, stat) { return metrics[name] ? metrics[name].values[stat] : null; }
  function ms(v)   { return v != null ? `${Math.round(v).toLocaleString('en-US')} ms` : 'N/A'; }
  function pct(v)  { return v != null ? `${parseFloat((v * 100).toFixed(2))}%` : 'N/A'; }
  function num(v)  { return v != null ? Math.round(v).toLocaleString() : 'N/A'; }
  function rps(v)  { return v != null ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : 'N/A'; }
  function dur(t) {
    if (t == null) return 'N/A';
    if (t < 60000) return `${(t / 1000).toFixed(1)}s`;
    return `${Math.floor(t / 60000)}m ${Math.round((t % 60000) / 1000)}s`;
  }

  const failRate   = val('http_req_failed', 'rate');
  const errorColor = failRate == null ? '#9e9e9e'
    : failRate > 0.05 ? '#c62828'
    : failRate > 0.01 ? '#d97706'
    : '#2e7d32';

  const passCount = Object.values(thresholds).filter(t => t.ok !== false).length;
  const failCount = Object.values(thresholds).filter(t => t.ok === false).length;

  function countChecks(group) {
    if (!group) return { passes: 0, fails: 0 };
    let p = 0, f = 0;
    (group.checks || []).forEach(c => { p += c.passes; f += c.fails; });
    (group.groups || []).forEach(g => { const s = countChecks(g); p += s.passes; f += s.fails; });
    return { passes: p, fails: f };
  }
  const checkTotals  = countChecks(rootGroup);
  const totalReqs    = val('http_reqs', 'count');
  const failedReqs   = (totalReqs != null && failRate != null) ? Math.round(totalReqs * failRate) : null;

  const testDescriptions = {
    smoke:      'A smoke test runs a minimal load (1 user) to quickly verify the system is up and responding correctly. It should pass before running any heavier tests.',
    load:       'A load test simulates expected real-world traffic to verify the system handles normal and peak usage within acceptable response times.',
    stress:     'A stress test pushes the system beyond normal load to find its limits and observe how it behaves under pressure. Some failures are expected.',
    soak:       'A soak test runs at normal load for an extended period to detect memory leaks, connection exhaustion, or gradual performance degradation over time.',
    spike:      'A spike test simulates a sudden burst of traffic to verify the system can handle unexpected surges and recover gracefully afterwards.',
    breakpoint: 'A breakpoint test gradually increases load until the system fails, to find the exact request-per-second ceiling.',
  };
  const testDesc = testDescriptions[testName.toLowerCase()] || 'A performance test to measure how the system responds under load.';

  const thresholdItems = Object.entries(thresholds).map(([, result]) => {
    const pass = result.ok !== false;
    const name = `${friendlyMetricName(result.metric)}: ${humanizeCondition(result.metric, result.condition)}`;
    return `
    <div class="prescan-item ${pass ? 'pass' : 'fail'}">
      <span class="prescan-status">${pass ? 'PASS' : 'FAIL'}</span>
      <div class="prescan-check">${name}</div>
    </div>`;
  }).join('');

  const configRows = [
    ['Environment',    env.toUpperCase()],
    ['System Tested',  target],
    ['Test Type',      testName.toUpperCase()],
    ['Duration',       dur(testDurationMs)],
    ['Request per Second', `${rps(val('http_reqs', 'rate'))} req/s`, 'Requests per second (req/s) is the average rate at which the system was hit throughout the test. It is calculated by dividing the total request count by the test duration.'],
    ['Iterations',     `${num(val('iterations', 'count'))}${val('iterations', 'rate') != null ? ` (${rps(val('iterations', 'rate'))}/s)` : ''}`, 'Iterations per second (/s) is the average rate at which virtual users completed full script runs. It is calculated by dividing the total iteration count by the test duration.'],
  ].map(([k, v, tip]) => `
    <div class="config-row">
      <span class="config-key">${k}${tip ? ` <span class="info-icon" style="margin-left:4px"><span class="info-tooltip">${tip}</span></span>` : ''}</span>
      <span class="config-val">${v}</span>
    </div>`).join('');

  const httpPhases = [
    ['Queued',               'http_req_blocked',         'Time the request spent waiting before being sent, often due to connection limits.'],
    ['Connecting',           'http_req_connecting',      'Time spent establishing a TCP connection to the server.'],
    ['Security (TLS)',       'http_req_tls_handshaking', 'Time to negotiate HTTPS security. Zero for plain HTTP or when connections are reused.'],
    ['Sending',              'http_req_sending',         'Time to upload the request body to the server.'],
    ['Waiting for Server',   'http_req_waiting',         'How long the server took to start sending its response. Usually the largest component of total request time.'],
    ['Receiving',            'http_req_receiving',       'Time to download the response body from the server.'],
  ];
  const httpBreakdownRows = httpPhases.map(([label, metric, tip]) => {
    const avgV = val(metric, 'avg');
    if (avgV == null) return '';
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${label} <span class="info-icon"><span class="info-tooltip">${tip}</span></span></span>
        <span class="breakdown-val">${ms(val(metric, 'min'))}</span>
        <span class="breakdown-val">${ms(avgV)}</span>
        <span class="breakdown-val">${ms(val(metric, 'p(95)'))}</span>
        <span class="breakdown-val">${ms(val(metric, 'max'))}</span>
      </div>`;
  }).filter(Boolean).join('');

  const httpBreakdownSection = httpBreakdownRows ? `
  <div class="meta-section toc-sect" id="toc-http">
    <div class="meta-section-title">Request Time Breakdown <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">Shows where time is spent within each HTTP request. All phases add up to the total response time.</span></span></div>
    <div class="breakdown-table">
      <div class="breakdown-header"><span>Phase</span><span>Min</span><span>Average</span><span>95th %</span><span>Max</span></div>
      ${httpBreakdownRows}
    </div>
  </div>` : '';

  // Iteration and group duration timing
  const iterDurVals   = metrics['iteration_duration'] ? metrics['iteration_duration'].values : null;
  const groupDurRows  = Object.entries(metrics)
    .filter(([name]) => name.startsWith('group_duration'))
    .map(([name, metric]) => {
      const label = name === 'group_duration'
        ? 'All Groups'
        : name.replace(/^group_duration\{group::(.+?)::\}$/, '$1').replace(/::/g, ' / ');
      const v = metric.values;
      return `<div class="breakdown-row">
        <span class="breakdown-label">${label}</span>
        <span class="breakdown-val">${ms(v.min)}</span>
        <span class="breakdown-val">${ms(v.avg)}</span>
        <span class="breakdown-val">${ms(v['p(95)'])}</span>
        <span class="breakdown-val">${ms(v.max)}</span>
      </div>`;
    }).join('');
  const additionalTimingSection = (iterDurVals || groupDurRows) ? `
  <div class="meta-section toc-sect" id="toc-iter">
    <div class="meta-section-title">Iteration &amp; Group Timing <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">Iteration duration is the time for one complete loop through the test script. Group duration shows time spent inside each named group() block.</span></span></div>
    <div class="breakdown-table">
      <div class="breakdown-header"><span>Metric</span><span>Min</span><span>Average</span><span>95th %</span><span>Max</span></div>
      ${iterDurVals ? `<div class="breakdown-row">
        <span class="breakdown-label">Iteration Duration</span>
        <span class="breakdown-val">${ms(iterDurVals.min)}</span>
        <span class="breakdown-val">${ms(iterDurVals.avg)}</span>
        <span class="breakdown-val">${ms(iterDurVals['p(95)'])}</span>
        <span class="breakdown-val">${ms(iterDurVals.max)}</span>
      </div>` : ''}
      ${groupDurRows}
    </div>
  </div>` : '';

  const tagGroups = {};
  Object.entries(metrics).forEach(([name, metric]) => {
    const m = name.match(/^(.+?)\{(.+?)\}$/);
    if (!m) return;
    const [, base, tagExpr] = m;
    if (!['http_req_duration', 'http_req_failed'].includes(base)) return;
    const [tagKey, tagVal] = tagExpr.split(':');
    if (!['scenario', 'page'].includes(tagKey)) return;
    if (!tagGroups[tagVal]) tagGroups[tagVal] = { tagKey, duration: null, failed: null, failThresholds: {} };
    if (base === 'http_req_duration') tagGroups[tagVal].duration = metric.values;
    if (base === 'http_req_failed') {
      tagGroups[tagVal].failed = metric.values;
      if (metric.thresholds) tagGroups[tagVal].failThresholds = metric.thresholds;
    }
  });

  let breakdownSection = '';
  if (Object.keys(tagGroups).length > 0) {
    const rows = Object.entries(tagGroups).map(([tag, g]) => {
      const errRate      = g.failed ? g.failed.rate : null;
      const hasThresh    = Object.keys(g.failThresholds).length > 0;
      const errFail      = hasThresh && Object.values(g.failThresholds).some(t => t.ok === false);
      const errPass      = hasThresh && !errFail;
      const errClass     = errRate == null ? '' : errRate > 0.05 ? 'err-fail' : errRate > 0.01 ? 'err-warn' : 'err-pass';
      const badge        = errFail
        ? ' <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:#ffcdd2;color:#c62828;margin-left:4px">FAIL</span>'
        : errPass
          ? ' <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:#c8e6c9;color:#2e7d32;margin-left:4px">PASS</span>'
          : '';
      return `<tr>
          <td>${tag.replace(/_/g, ' ')}</td>
          <td>${ms(g.duration ? g.duration.avg : null)}</td>
          <td>${ms(g.duration ? g.duration['med'] : null)}</td>
          <td>${ms(g.duration ? g.duration['p(90)'] : null)}</td>
          <td>${ms(g.duration ? g.duration['p(95)'] : null)}</td>
          <td class="err-cell ${errClass}">${pct(errRate)}</td>
          <td class="err-cell ${errClass}">${g.failed ? num(g.failed.passes) : 'N/A'}</td>
          <td>${badge}</td>
        </tr>`;
    }).join('');
    breakdownSection = `
  <div class="meta-section toc-sect" id="toc-breakdown">
    <div class="meta-section-title">Breakdown by Scenario / Page <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">Response times and error rates split by each scenario or page. Useful for pinpointing which part of the test is slow or failing.</span></span></div>
    <table class="scenario-table">
      <thead><tr><th>Scenario / Page</th><th>Average</th><th>Median</th><th>90th %</th><th>95th %</th><th>Error Rate</th><th>Fails</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  }

  const builtinPrefixes = ['http_req_', 'http_reqs', 'data_', 'iteration', 'vus', 'checks', 'group_duration', 'dropped_iterations'];
  const customEntries = Object.entries(metrics).filter(([name]) =>
    !name.includes('{') && !builtinPrefixes.some(p => name.startsWith(p))
  );
  let customMetricsSection = '';
  if (customEntries.length > 0) {
    const rows = customEntries.map(([name, metric]) => {
      let valueStr = '';
      if (metric.type === 'rate')    valueStr = pct(metric.values.rate);
      else if (metric.type === 'trend')   valueStr = `Average ${ms(metric.values.avg)}, 95th % ${ms(metric.values['p(95)'])}`;
      else if (metric.type === 'counter') valueStr = num(metric.values.count);
      else if (metric.type === 'gauge')   valueStr = num(metric.values.value);
      const hasT     = metric.thresholds && Object.keys(metric.thresholds).length > 0;
      const allTPass = !hasT || Object.values(metric.thresholds).every(t => t.ok !== false);
      const badge = hasT
        ? `<span class="detail-badge ${allTPass ? 'pass' : 'fail'}">${allTPass ? 'PASS' : 'FAIL'}</span>`
        : '';
      return `<tr><td>${friendlyMetricName(name)}</td><td>${valueStr}</td><td>${badge}</td></tr>`;
    }).join('');
    customMetricsSection = `
  <div class="meta-section toc-sect" id="toc-custom">
    <div class="meta-section-title">Application Metrics <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">Metrics your team defined in the test script to track how the application behaved, such as login success rate or page load time.</span></span></div>
    <table class="detail-table">
      <thead><tr><th>Metric</th><th>Value</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  }

  const customNames    = new Set(customEntries.map(([name]) => name));
  const trendEntries   = Object.entries(metrics).filter(([name, m]) => m.type === 'trend'   && !customNames.has(name)).sort(([a], [b]) => a.localeCompare(b));
  const rateEntries    = Object.entries(metrics).filter(([name, m]) => m.type === 'rate'    && !customNames.has(name)).sort(([a], [b]) => a.localeCompare(b));
  const counterEntries = Object.entries(metrics).filter(([name, m]) => m.type === 'counter' && !customNames.has(name)).sort(([a], [b]) => a.localeCompare(b));
  function detailBadge(metric) {
    const hasT = metric.thresholds && Object.keys(metric.thresholds).length;
    if (!hasT) return '';
    const allPass = Object.values(metric.thresholds).every(t => t.ok !== false);
    return ` <span class="detail-badge ${allPass ? 'pass' : 'fail'}">${allPass ? 'PASS' : 'FAIL'}</span>`;
  }
  const trendTableHtml = trendEntries.length ? `
    <table class="detail-table">
      <thead><tr><th>Metric</th><th>Average</th><th>Min</th><th>Median</th><th>Max</th><th>90th %</th><th>95th %</th><th></th></tr></thead>
      <tbody>${trendEntries.map(([name, m]) => {
        const v = m.values;
        return `<tr><td>${name}</td><td>${ms(v.avg)}</td><td>${ms(v.min)}</td><td>${ms(v.med)}</td><td>${ms(v.max)}</td><td>${ms(v['p(90)'])}</td><td>${ms(v['p(95)'])}</td><td>${detailBadge(m)}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '';
  const rateTableHtml = rateEntries.length ? `
    <table class="detail-table">
      <thead><tr><th>Metric</th><th>Rate</th><th>True Count</th><th>False Count</th><th></th></tr></thead>
      <tbody>${rateEntries.map(([name, m]) => {
        const v = m.values;
        return `<tr><td>${name}</td><td>${pct(v.rate)}</td><td>${num(v.passes)}</td><td>${num(v.fails)}</td><td>${detailBadge(m)}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '';
  const counterTableHtml = counterEntries.length ? `
    <table class="detail-table">
      <thead><tr><th>Metric</th><th>Count</th><th>Rate/s</th><th></th></tr></thead>
      <tbody>${counterEntries.map(([name, m]) => {
        const v = m.values;
        return `<tr><td>${name}</td><td>${num(v.count)}</td><td>${rps(v.rate)}</td><td>${detailBadge(m)}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '';
  const dtabTabs = [
    trendTableHtml   ? { id: 'dtab-trends',   label: 'Response Times', html: trendTableHtml }   : null,
    rateTableHtml    ? { id: 'dtab-rates',    label: 'Success Rates',  html: rateTableHtml }    : null,
    counterTableHtml ? { id: 'dtab-counters', label: 'Totals',         html: counterTableHtml } : null,
  ].filter(Boolean);
  const detailedMetricsSection = dtabTabs.length ? `
  <div class="meta-section toc-sect" id="toc-detailed">
    <div class="meta-section-title">Detailed Metrics <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">All metrics with complete statistics. Response Times show all percentiles. Success Rates show proportion and raw counts. Totals show cumulative counts and per-second rates.</span></span></div>
    <div class="dtabs">
      <div class="dtab-labels">${dtabTabs.map((t, i) => `<button class="dtab-btn${i === 0 ? ' active' : ''}" onclick="dtabSwitch(this,'${t.id}')">${t.label}</button>`).join('')}</div>
      ${dtabTabs.map((t, i) => `<div id="${t.id}" class="dtab-panel${i > 0 ? ' dtab-hidden' : ''}">${t.html}</div>`).join('')}
    </div>
  </div>` : '';

  function buildChecksHtml(group) {
    if (!group) return '';
    const sections = [];
    if (group.checks && group.checks.length > 0) sections.push({ name: 'General', items: group.checks });
    (group.groups || []).forEach(g => {
      if (g.checks && g.checks.length > 0) sections.push({ name: g.name, items: g.checks });
    });
    if (sections.length === 0) return '';
    function renderItems(items) {
      return `<div class="checks-list">${items.map(c => {
        const pass  = c.fails === 0;
        const total = c.passes + c.fails;
        const pct2  = total > 0 ? Math.round(c.passes / total * 100) : 0;
        return `<div class="prescan-item ${pass ? 'pass' : 'fail'}">
          <span class="prescan-status">${pass ? 'PASS' : 'FAIL'}</span>
          <div class="prescan-check">${humanizeCheckName(c.name)}</div>
          <span class="check-count">${num(c.passes)} passed, ${num(c.fails)} failed <span style="color:#9e9e9e">(${pct2}%)</span></span>
        </div>`;
      }).join('')}</div>`;
    }
    if (sections.length === 1) return renderItems(sections[0].items);
    const tabs = sections.map((s, i) => ({
      id:    `ctab-${i}`,
      label: s.name.replace(/_/g, ' '),
      html:  renderItems(s.items),
    }));
    return `<div class="dtabs">
      <div class="dtab-labels">${tabs.map((t, i) => `<button class="dtab-btn${i === 0 ? ' active' : ''}" onclick="dtabSwitch(this,'${t.id}')">${t.label}</button>`).join('')}</div>
      ${tabs.map((t, i) => `<div id="${t.id}" class="dtab-panel${i > 0 ? ' dtab-hidden' : ''}">${t.html}</div>`).join('')}
    </div>`;
  }
  const checksHtml = buildChecksHtml(rootGroup);
  const checksSection = checksHtml ? `
  <div class="meta-section toc-sect" id="toc-checks">
    <div class="meta-section-title">Quality Checks <span class="info-icon" style="margin-left:6px"><span class="info-tooltip">Automated checks that verify the server responded correctly. For example: "did the login return HTTP 200?" or "was the response under 2 seconds?" A FAIL means the server returned an unexpected result.</span></span></div>
    ${checksHtml}
  </div>` : '';

  // Scenario comparison bars
  const scenarioBars = (() => {
    const entries = Object.entries(tagGroups)
      .filter(([, g]) => g.duration && g.duration['p(95)'] != null)
      .sort(([, a], [, b]) => (b.duration['p(95)'] || 0) - (a.duration['p(95)'] || 0));
    if (entries.length < 1) return '';
    const maxP95 = Math.max(...entries.map(([, g]) => g.duration['p(95)']));
    const bH = 26, gap = 10, lW = 130, VW = 620, barMax = VW - lW - 120;
    const VH = entries.length * (bH + gap) + gap;
    const rows = entries.map(([tag, g], i) => {
      const p95 = g.duration['p(95)'];
      const bw  = maxP95 > 0 ? +((p95 / maxP95) * barMax).toFixed(1) : 0;
      const y   = gap + i * (bH + gap);
      const err = g.failed ? g.failed.rate : null;
      const col = err != null && err > 0.05 ? '#e53935' : err != null && err > 0.01 ? '#fb8c00' : '#00695c';
      return `<text x="${lW-8}" y="${y+bH/2+4}" text-anchor="end" font-size="12" fill="#37474f" font-family="-apple-system,sans-serif">${tag.replace(/_/g,' ')}</text>` +
             `<rect x="${lW}" y="${y}" width="${bw}" height="${bH}" rx="4" fill="${col}" opacity=".8"/>` +
             `<text x="${lW+bw+8}" y="${y+bH/2+4}" font-size="11" font-weight="700" fill="${col}" font-family="-apple-system,sans-serif">${Math.round(p95).toLocaleString('en-US')} ms (95th %)</text>`;
    }).join('');
    return `<div style="flex:1;min-width:200px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;font-weight:700;margin-bottom:10px">95th % by Scenario / Page <span class="info-icon" style="margin-left:4px;vertical-align:middle"><span class="info-tooltip" style="text-transform:none;letter-spacing:normal">The 95th percentile is the industry standard for measuring user experience. It shows how fast 95% of users were served, filtering out rare extreme outliers that would skew the average.</span></span></div>
      <div style="overflow-x:auto">
        <svg width="100%" viewBox="0 0 ${VW} ${VH}" style="min-width:220px">${rows}</svg>
      </div>
      <div style="display:flex;gap:14px;margin-top:8px;font-size:11px;color:#616161;flex-wrap:wrap;text-transform:none;letter-spacing:normal">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#00695c;margin-right:4px;vertical-align:middle"></span>Low error (&lt;1%)</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#fb8c00;margin-right:4px;vertical-align:middle"></span>Moderate (1-5%)</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#e53935;margin-right:4px;vertical-align:middle"></span>High error (&gt;5%)</span>
      </div>
    </div>`;
  })();

  const chartsSection = scenarioBars ? `
  <div class="meta-section toc-sect" id="toc-glance">
    <div class="meta-section-title">At a Glance</div>
    ${scenarioBars}
  </div>` : '';

  // Executive summary narrative
  const p95Req       = metrics['http_req_duration'] ? metrics['http_req_duration'].values['p(95)'] : null;
  const totalThresh  = passCount + failCount;
  const failingNames = [...new Set(
    Object.entries(thresholds).filter(([, r]) => r.ok === false).map(([, r]) => friendlyMetricName(r.metric))
  )];
  const execResult = allPassed
    ? `The ${testName.toLowerCase()} test <span style="color:#2e7d32;font-weight:700">passed</span>: all ${totalThresh} performance goal${totalThresh !== 1 ? 's' : ''} were met.`
    : `The ${testName.toLowerCase()} test <span style="color:#c62828;font-weight:700">failed</span>: ${failCount} of ${totalThresh} performance goal${totalThresh !== 1 ? 's' : ''} ${failCount === 1 ? 'was' : 'were'} not met.`;
  const peakVUs   = val('vus_max', 'max');
  const iterCount = val('iterations', 'count');
  const execBodyParts = [];
  if (failRate != null) {
    execBodyParts.push(failRate === 0
      ? 'No request errors were recorded.'
      : `The error rate reached <strong>${pct(failRate)}</strong> across <strong>${num(totalReqs)}</strong> requests.`);
  }
  if (p95Req != null) execBodyParts.push(`95% of requests completed in <strong>${ms(p95Req)}</strong>.`);
  if (peakVUs != null) {
    const loadParts = [`The test peaked at <strong>${num(peakVUs)}</strong> virtual user${peakVUs === 1 ? '' : 's'}`];
    if (testDurationMs)    loadParts.push(`over <strong>${dur(testDurationMs)}</strong>`);
    if (iterCount != null) loadParts.push(`completing <strong>${num(iterCount)}</strong> iterations`);
    execBodyParts.push(loadParts.join(', ') + '.');
  }
  if (failingNames.length > 0 && failingNames.length <= 3) {
    execBodyParts.push(`The failing goal${failingNames.length > 1 ? 's were' : ' was'} <strong>${failingNames.join(', ')}</strong>.`);
  } else if (failingNames.length > 3) {
    execBodyParts.push('Multiple performance goals were not met, see the Performance Goals section below.');
  }
  const execBody = execBodyParts.join(' ');

  const tocItems = [
    { id: 'toc-summary',   label: 'Summary' },
    { id: 'toc-config',    label: 'Test Configuration' },
    { id: 'perf-targets',  label: 'Performance Goals' },
    ...(chartsSection           ? [{ id: 'toc-glance',    label: 'At a Glance' }]           : []),
    { id: 'toc-response',      label: 'Response Times' },
    ...(httpBreakdownSection    ? [{ id: 'toc-http',       label: 'Request Time Breakdown' }] : []),
    ...(additionalTimingSection ? [{ id: 'toc-iter',       label: 'Iteration Timing' }]     : []),
    ...(breakdownSection        ? [{ id: 'toc-breakdown',  label: 'Scenario / Page' }]      : []),
    ...(customMetricsSection    ? [{ id: 'toc-custom',     label: 'Application Metrics' }]  : []),
    ...(detailedMetricsSection  ? [{ id: 'toc-detailed',   label: 'Detailed Metrics' }]     : []),
    ...(checksSection           ? [{ id: 'toc-checks',     label: 'Quality Checks' }]       : []),
  ];
  const tocNavHtml = tocItems.map(t => `<a class="toc-item" href="#${t.id}" onclick="tocActivate(this)">${t.label}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance Test Report: ${testName.toUpperCase()} (${env.toUpperCase()})</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23004d40'/><path d='M 6 22 A 12 12 0 0 1 26 22' stroke='%23fff' stroke-width='2.5' fill='none' stroke-linecap='round'/><path d='M 16 22 L 22 12' stroke='%2380cbc4' stroke-width='2.5' stroke-linecap='round'/><circle cx='16' cy='22' r='2.5' fill='%23fff'/></svg>">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#212121;background:#f0f2f5}
header{background:#e0f2f1;border-bottom:3px solid #00695c;color:#00695c;padding:20px 40px}
header h1{font-size:20px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
header .meta{font-size:12px;margin-top:6px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.75}
header .meta span{margin-right:16px}
.container{max-width:1080px;margin:0 auto;padding:28px 20px}
.report-intro{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:20px 24px;margin-bottom:20px;border-left:4px solid ${allPassed ? '#43a047' : '#e53935'}}
.exec-result{font-size:15px;font-weight:600;color:#212121;line-height:1.5;margin-bottom:8px}
.exec-body{font-size:13px;color:#37474f;line-height:1.8}
.tech-divider{display:flex;align-items:center;gap:12px;margin:8px 0 20px;color:#b0bec5;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:700}
.tech-divider::before,.tech-divider::after{content:'';flex:1;height:1px;background:#e0e0e0}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.summary-card{background:#fff;border-radius:10px;padding:20px 16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.1);display:flex;flex-direction:column;align-items:center;justify-content:center}
.summary-card .num{font-size:40px;font-weight:800;line-height:1}
.summary-card .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.8px;font-weight:600;margin-top:4px;display:flex;align-items:center;justify-content:center;gap:3px}
.card-verdict .num,.card-verdict .lbl{color:${allPassed ? '#2e7d32' : '#c62828'}}
.card-err .num,.card-err .lbl{color:${errorColor}}
.card-vus .num,.card-vus .lbl{color:#37474f}
.card-pass .num,.card-pass .lbl{color:#2e7d32}
.card-fail .num,.card-fail .lbl{color:${failCount > 0 ? '#c62828' : '#9e9e9e'}}
.card-vus{border-top:3px solid #9e9e9e}
.card-pass{border-top:3px solid #2e7d32}
.meta-section{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:20px 24px;margin-bottom:20px}
.meta-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#757575;font-weight:700;margin-bottom:14px;display:flex;align-items:center}
.config-row{display:flex;width:100%;border-bottom:1px solid #f5f5f5;padding:7px 0}
.config-row:last-child{border-bottom:none}
.config-key{font-size:12px;color:#757575;font-weight:600;width:160px;flex-shrink:0}
.config-val{font-size:13px;color:#212121;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.config-badge{margin-left:auto;padding-left:12px;flex-shrink:0;display:flex;align-items:center}
.metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
.metric-card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:18px 20px;border-left:3px solid #b2dfdb}
.metric-label{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#757575;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:4px}
.metric-value{font-size:26px;font-weight:700;color:#212121;line-height:1}
.metric-sub{font-size:11px;color:#9e9e9e;margin-top:4px}
.metric-value.na{font-size:20px;color:#bdbdbd}
.metric-max-note{font-size:12px;color:#9e9e9e;text-align:right;margin-bottom:0;padding-top:2px}
.prescan-list{display:flex;flex-direction:column;gap:6px}
.prescan-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border-left:4px solid;border-radius:0 6px 6px 0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.prescan-item.pass{border-color:#43a047}
.prescan-item.fail{border-color:#e53935}
.prescan-status{font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.prescan-item.pass .prescan-status{background:#e8f5e9;color:#2e7d32}
.prescan-item.fail .prescan-status{background:#ffebee;color:#c62828}
.prescan-check{font-size:13px;color:#212121}
.checks-list{display:flex;flex-direction:column;gap:6px}
.checks-group-name{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;font-weight:700;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #f0f0f0}
.checks-group:first-child .checks-group-name{margin-top:0}
.check-count{font-size:12px;color:#757575;white-space:nowrap;margin-left:auto;padding-left:12px}
.breakdown-table{display:flex;flex-direction:column}
.breakdown-header{display:grid;grid-template-columns:1fr 80px 80px 80px 80px;padding:6px 0;border-bottom:2px solid #e0e0e0;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;font-weight:700}
.breakdown-row{display:grid;grid-template-columns:1fr 80px 80px 80px 80px;padding:8px 0;border-bottom:1px solid #f5f5f5;align-items:center}
.breakdown-row:last-child{border-bottom:none}
.breakdown-label{font-size:12px;color:#37474f;display:flex;align-items:center;gap:4px}
.breakdown-val{font-size:13px;color:#212121;font-variant-numeric:tabular-nums}
.scenario-table{width:100%;border-collapse:collapse;font-size:13px}
.scenario-table th{text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;font-weight:700;border-bottom:2px solid #e0e0e0}
.scenario-table td{padding:8px 10px;border-bottom:1px solid #f5f5f5;color:#212121}
.scenario-table tr:last-child td{border-bottom:none}
.err-cell{font-weight:600}
.err-pass{color:#2e7d32}.err-warn{color:#d97706}.err-fail{color:#c62828}
.info-icon{display:inline-block;width:13px;height:13px;border-radius:50%;background:#b0bec5;cursor:default;position:relative;flex-shrink:0;vertical-align:middle;margin-left:2px}
.info-icon::before{content:'';position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;top:2px;left:50%;transform:translateX(-50%)}
.info-icon::after{content:'';position:absolute;width:2px;height:4px;background:#fff;border-radius:1px;bottom:2px;left:50%;transform:translateX(-50%)}
.info-icon:hover .info-tooltip{display:block}
.info-tooltip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#37474f;color:#fff;font-size:11px;font-weight:400;padding:8px 10px;border-radius:6px;width:230px;line-height:1.5;z-index:10;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.2);white-space:normal;text-transform:none;letter-spacing:normal}
.info-tooltip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#37474f}
.legend{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:20px;overflow:hidden}
.legend-summary{padding:13px 18px;cursor:pointer;font-size:13px;font-weight:600;color:#546e7a;list-style:none;user-select:none;display:flex;align-items:center;gap:8px}
.legend-summary::-webkit-details-marker{display:none}
.legend-summary:hover{background:#fafafa}
.legend-chevron{font-size:10px;color:#b0bec5;transition:transform .15s;display:inline-block}
details.legend[open] .legend-chevron{transform:rotate(90deg)}
.legend-body{border-top:1px solid #f0f0f0;padding:20px 24px}
.legend-def{color:#616161;line-height:1.5;font-size:13px}
footer{background:#e0f2f1;border-top:3px solid #00695c;text-align:center;padding:16px 20px;color:#00695c;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}
.test-type-note{margin-top:12px;padding:10px 14px;background:#f5f5f5;border-radius:6px;font-size:12px;color:#546e7a;line-height:1.6}
#glossary-btn{position:fixed;bottom:24px;right:24px;width:44px;height:44px;border-radius:50%;background:#00695c;color:#fff;border:none;font-size:18px;font-weight:700;cursor:pointer;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.3);line-height:1}
#glossary-btn:hover{background:#004d40}
#glossary-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;align-items:center;justify-content:center}
#glossary-modal.open{display:flex}
.glossary-panel{background:#fff;border-radius:12px;padding:28px 32px;max-width:660px;width:90%;max-height:82vh;overflow-y:auto;position:relative}
.glossary-close{position:absolute;top:12px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#9e9e9e;line-height:1}
.glossary-close:hover{color:#212121}
.glossary-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#00695c;margin-bottom:20px}
.glossary-group-title{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#9e9e9e;font-weight:700;margin-bottom:8px}
.glossary-items{display:block;font-size:12px}
.glossary-items > div{margin-bottom:6px;break-inside:avoid}
.glossary-items strong{color:#37474f}
.glossary-items span{color:#616161}
.dtabs{margin-top:4px}
.dtab-labels{display:flex;gap:2px;flex-wrap:wrap;border-bottom:2px solid #e0e0e0;margin-bottom:16px}
.dtab-btn{padding:7px 16px;border:none;background:none;cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#9e9e9e;border-bottom:2px solid transparent;margin-bottom:-2px;border-radius:4px 4px 0 0;transition:color .15s}
.dtab-btn:hover{color:#546e7a;background:#f5f5f5}
.dtab-btn.active{color:#00695c;border-bottom-color:#00695c}
.dtab-panel.dtab-hidden{display:none}
.detail-table{width:100%;border-collapse:collapse;font-size:12px}
.detail-table th{text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;font-weight:700;border-bottom:2px solid #e0e0e0}
.detail-table td{padding:6px 10px;border-bottom:1px solid #f5f5f5;color:#212121;font-variant-numeric:tabular-nums}
.detail-table tr:last-child td{border-bottom:none}
.detail-badge{font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;vertical-align:middle;margin-left:4px}
.detail-badge.pass{background:#c8e6c9;color:#2e7d32}
.detail-badge.fail{background:#ffcdd2;color:#c62828}
#toc-wrap{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:150;display:flex;align-items:center}
#toc-btn{background:#00695c;color:#fff;border:none;border-radius:6px 0 0 6px;padding:18px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;writing-mode:vertical-rl;line-height:1;flex-shrink:0;box-shadow:-2px 0 8px rgba(0,0,0,.15)}
#toc-btn:hover{background:#004d40}
#toc-panel{background:#fff;border:1px solid #e0e0e0;border-right:none;border-radius:8px 0 0 8px;box-shadow:-3px 0 16px rgba(0,0,0,.1);padding:8px 0;min-width:190px;max-height:70vh;overflow-y:auto;display:none}
#toc-panel.open{display:block}
#toc-heading{padding:10px 16px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9e9e9e;border-bottom:1px solid #f0f0f0;margin-bottom:4px}
.toc-item{display:block;padding:8px 16px;font-size:12px;color:#546e7a;text-decoration:none;border-left:3px solid transparent;white-space:nowrap}
.toc-item:hover{color:#00695c;background:#f5f5f5}
.toc-item.active{color:#00695c;font-weight:700;border-left-color:#00695c;background:#f1f8f7}
@media print{
  body{background:#fff}
  .container{padding:0}
  header,footer{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .summary-card,.meta-section,.prescan-item{box-shadow:none;border:1px solid #e0e0e0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .metric-card{box-shadow:none;border:1px solid #e0e0e0;border-left:3px solid #b2dfdb;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #glossary-btn,#glossary-modal,#toc-wrap{display:none!important}
  @page{margin:1cm;size:A4}
}
</style>
</head>
<body>
<header>
  <h1>Performance Test Report</h1>
  <div class="meta">
    <span>Generated: ${now}</span>
  </div>
</header>
<div class="container">

  <div class="report-intro toc-sect" id="toc-summary">
    <div class="exec-result">${execResult}</div>
    <div class="exec-body">${testDesc}${execBody ? '<br><br>' + execBody : ''}</div>
  </div>

  <div class="summary">
    <div class="summary-card card-verdict" style="border-top:3px solid ${allPassed ? '#2e7d32' : '#c62828'}">
      <div class="num">${verdict}</div>
      <div class="lbl">Result</div>
    </div>
    <div class="summary-card card-err" style="border-top:3px solid ${errorColor}">
      <div class="num">${pct(failRate)}</div>
      <div class="lbl">Error Rate <span class="info-icon"><span class="info-tooltip">Percentage of requests that failed (HTTP 4xx/5xx or network error). Even 1% means 1 in 100 users hit a problem.</span></span></div>
    </div>
    <div class="summary-card card-fail" style="border-top:3px solid ${failCount > 0 ? '#c62828' : '#bdbdbd'}">
      <div class="num">${failCount}</div>
      <div class="lbl">Goals Failed <span class="info-icon"><span class="info-tooltip">Number of performance goals that were not met. Any failed goal makes the overall result FAILED.</span></span></div>
    </div>
    <div class="summary-card card-pass">
      <div class="num">${passCount}</div>
      <div class="lbl">Goals Passed <span class="info-icon"><span class="info-tooltip">Number of performance goals that were met. All goals must pass for the overall result to be PASSED.</span></span></div>
    </div>
    <div class="summary-card" style="border-top:3px solid ${failedReqs != null && failedReqs > 0 ? '#c62828' : '#bdbdbd'}">
      <div class="num" style="color:${failedReqs != null && failedReqs > 0 ? '#c62828' : '#9e9e9e'}">${num(failedReqs)}</div>
      <div class="lbl" style="color:${failedReqs != null && failedReqs > 0 ? '#c62828' : '#9e9e9e'}">Failed Requests <span class="info-icon"><span class="info-tooltip">Total number of requests that returned an error. Calculated from error rate multiplied by total requests.</span></span></div>
    </div>
    <div class="summary-card" style="border-top:3px solid ${checkTotals.fails > 0 ? '#c62828' : '#bdbdbd'}">
      <div class="num" style="color:${checkTotals.fails > 0 ? '#c62828' : '#9e9e9e'}">${num(checkTotals.fails)}</div>
      <div class="lbl" style="color:${checkTotals.fails > 0 ? '#c62828' : '#9e9e9e'}">Failed Checks <span class="info-icon"><span class="info-tooltip">Total number of quality checks that failed. A failure means the server returned an unexpected response.</span></span></div>
    </div>
    <div class="summary-card card-vus" style="border-top:3px solid #9e9e9e">
      <div class="num">${num(val('vus_max', 'max'))}</div>
      <div class="lbl">Peak Users <span class="info-icon"><span class="info-tooltip">Maximum number of Virtual Users (VUs) active at the same time. Each VU simulates one real person using the system independently.</span></span></div>
    </div>
    <div class="summary-card" style="border-top:3px solid #9e9e9e">
      <div class="num">${num(val('http_reqs', 'count'))}</div>
      <div class="lbl">Total Requests <span class="info-icon"><span class="info-tooltip">Total number of HTTP requests sent to the server during the test.</span></span></div>
    </div>
  </div>

  <div class="meta-section toc-sect" id="toc-config">
    <div class="meta-section-title">Test Configuration</div>
    ${configRows}
  </div>

  <div class="meta-section toc-sect" id="perf-targets">
    <div class="meta-section-title">Performance Goals</div>
    <div class="prescan-list">
      ${thresholdItems}
    </div>
  </div>

  ${chartsSection}

  <div class="meta-section toc-sect" id="toc-response">
    <div class="meta-section-title">Response Times</div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Fastest <span class="info-icon"><span class="info-tooltip">The single fastest response during the test. Best-case scenario.</span></span></div>
        <div class="metric-value">${ms(val('http_req_duration', 'min'))}</div>
        <div class="metric-sub">Quickest single response</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Average <span class="info-icon"><span class="info-tooltip">The mean response time across all requests. Can be pulled up by a few slow outliers. The 95th Percentile is usually a more honest measure.</span></span></div>
        <div class="metric-value">${ms(val('http_req_duration', 'avg'))}</div>
        <div class="metric-sub">Mean across all requests</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Median <span class="info-icon"><span class="info-tooltip">50% of requests were faster than this. Less affected by extreme outliers than the average.</span></span></div>
        <div class="metric-value">${ms(val('http_req_duration', 'med'))}</div>
        <div class="metric-sub">Half of all requests were faster</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">90th Percentile <span class="info-icon"><span class="info-tooltip">90% of requests completed within this time. A common SLA benchmark.</span></span></div>
        <div class="metric-value">${ms(val('http_req_duration', 'p(90)'))}</div>
        <div class="metric-sub">9 in 10 users were faster</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">95th Percentile <span class="info-icon"><span class="info-tooltip">95% of requests completed within this time. The standard benchmark for user experience. Reflects real performance while filtering out rare outliers.</span></span></div>
        <div class="metric-value">${ms(val('http_req_duration', 'p(95)'))}</div>
        <div class="metric-sub">19 in 20 users were faster</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">99th Percentile <span class="info-icon"><span class="info-tooltip">99% of requests completed within this time. Shows the worst-case experience for 1 in 100 users.</span></span></div>
        <div class="metric-value${val('http_req_duration', 'p(99)') == null ? ' na' : ''}">${ms(val('http_req_duration', 'p(99)'))}</div>
        <div class="metric-sub">${val('http_req_duration', 'p(99)') == null ? 'Not configured in this test' : '99 in 100 users were faster'}</div>
      </div>
    </div>
  </div>

  ${(httpBreakdownSection || additionalTimingSection || breakdownSection || customMetricsSection || detailedMetricsSection || checksSection) ? '<div class="tech-divider">Technical Details</div>' : ''}

  ${httpBreakdownSection}

  ${additionalTimingSection}

  ${breakdownSection}

  ${customMetricsSection}

  ${detailedMetricsSection}

  ${checksSection}

</div>

<div id="toc-wrap">
  <nav id="toc-panel" aria-label="Contents">
    <div id="toc-heading">Contents</div>
    ${tocNavHtml}
  </nav>
  <button id="toc-btn" onclick="tocToggle()" title="Table of Contents">Contents</button>
</div>
<button id="glossary-btn" onclick="document.getElementById('glossary-modal').classList.add('open')" title="Glossary">?</button>
<div id="glossary-modal" onclick="if(event.target===this)this.classList.remove('open')">
  <div class="glossary-panel">
    <button class="glossary-close" onclick="document.getElementById('glossary-modal').classList.remove('open')">&#10005;</button>
    <div class="glossary-title">Glossary</div>
    <div style="display:flex;flex-direction:column;gap:24px">
      <div>
        <div class="glossary-group-title">Test Types</div>
        <div class="glossary-items" style="columns:2;column-gap:32px">
          <div><strong>Smoke</strong> <span>: minimal load (1 simulated user) to verify the system is up before heavier tests.</span></div>
          <div><strong>Load</strong> <span>: simulates expected real-world traffic to check normal and peak usage.</span></div>
          <div><strong>Stress</strong> <span>: pushes beyond normal load to find the breaking point. Some failures are expected.</span></div>
          <div><strong>Soak</strong> <span>: runs at normal load for an extended period to catch slow degradation over time.</span></div>
          <div><strong>Spike</strong> <span>: sudden burst of traffic to test whether the system can handle unexpected surges.</span></div>
          <div><strong>Breakpoint</strong> <span>: gradually increases load until the system fails, to find its maximum capacity.</span></div>
        </div>
      </div>
      <div>
        <div class="glossary-group-title">Key Terms</div>
        <div class="glossary-items" style="columns:2;column-gap:32px">
          <div><strong>Virtual User</strong> <span>: a simulated person using the system. 50 virtual users means 50 people using it at the same time.</span></div>
          <div><strong>Performance Goal</strong> <span>: a pass/fail rule set before the test runs, e.g. "95% of requests must complete in under 500ms".</span></div>
          <div><strong>SLA</strong> <span>: Service Level Agreement. A formal commitment on how the system should perform, e.g. "95% of requests must complete in under 500ms". Performance goals in this report are typically derived from SLA requirements.</span></div>
          <div><strong>95th Percentile</strong> <span>: 95% of users were served faster than this. The standard measure for real-world user experience.</span></div>
          <div><strong>Error Rate</strong> <span>: percentage of requests that failed. Even 1% means 1 in 100 users hit an error.</span></div>
          <div><strong>Iteration</strong> <span>: one complete run through the test script by a single virtual user. The total iterations count shows how much work all users completed together during the test.</span></div>
          <div><strong>Quality Check</strong> <span>: an automated verification that the server responded correctly, e.g. "did the page return status 200?".</span></div>
          <div><strong>TLS</strong> <span>: the security layer that encrypts data between the client and the server, making HTTPS connections safe. The "Security (TLS)" phase in the Request Time Breakdown shows how long this encryption handshake took. It is typically zero when connections are reused.</span></div>
          <div><strong>TCP</strong> <span>: the standard method computers use to establish a connection over the internet. Before any request is sent, a TCP connection must be set up between the test runner and the server. This is the "Connecting" phase in the Request Time Breakdown.</span></div>
        </div>
      </div>
    </div>
  </div>
</div>

<footer>Grafana &bull; k6 Performance Tests</footer>
<script>
function dtabSwitch(btn,id){var t=btn.closest('.dtabs');t.querySelectorAll('.dtab-btn').forEach(function(b){b.classList.remove('active')});t.querySelectorAll('.dtab-panel').forEach(function(p){p.classList.add('dtab-hidden')});btn.classList.add('active');document.getElementById(id).classList.remove('dtab-hidden')}
function tocToggle(){document.getElementById('toc-panel').classList.toggle('open')}
function tocClose(){document.getElementById('toc-panel').classList.remove('open')}
document.addEventListener('click',function(e){if(!e.target.closest('#toc-wrap'))tocClose()})
var _tocSects=[],_tocVis=new Set(),_tocLock=false,_tocLockTimer=null;
function tocActivate(el){
  document.querySelectorAll('.toc-item').forEach(function(a){a.classList.remove('active')});
  el.classList.add('active');
  _tocLock=true;
  clearTimeout(_tocLockTimer);
  _tocLockTimer=setTimeout(function(){_tocLock=false;},1000);
}
var _tocObs=new IntersectionObserver(function(entries){
  entries.forEach(function(e){e.isIntersecting?_tocVis.add(e.target.id):_tocVis.delete(e.target.id)});
  if(_tocLock)return;
  var top=_tocSects.find(function(id){return _tocVis.has(id)});
  if(top)document.querySelectorAll('.toc-item').forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+top)});
},{rootMargin:'-5% 0px -50% 0px',threshold:0});
document.querySelectorAll('.toc-sect').forEach(function(el){_tocSects.push(el.id);_tocObs.observe(el)});
</script>
</body>
</html>`;
}

function humanizeCheckName(name) {
  const colonIdx = name.indexOf(': ');
  if (colonIdx === -1) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  const rawPrefix = name.slice(0, colonIdx);
  const desc      = name.slice(colonIdx + 2).trim();
  const prefix    = rawPrefix.length <= 3
    ? rawPrefix.toUpperCase()
    : rawPrefix.charAt(0).toUpperCase() + rawPrefix.slice(1);

  // "200" → "Status is 200"
  if (/^\d{3}$/.test(desc)) {
    return `${prefix}: Status is ${desc}`;
  }
  // "home 200" → "Home returned status 200"
  const wordStatus = desc.match(/^(\w+)\s+(\d{3})$/);
  if (wordStatus) {
    return `${prefix}: ${wordStatus[1]} returned status ${wordStatus[2]}`;
  }
  // "pi < 2s" or "home < 500ms" → "Pi responded in under 2 seconds"
  const timeCmp = desc.match(/^(.+?)\s*<\s*(\d+(?:\.\d+)?)\s*(s|ms)$/i);
  if (timeCmp) {
    const thing = timeCmp[1].trim();
    const val   = timeCmp[2];
    const unit  = timeCmp[3].toLowerCase() === 's'
      ? `${val} second${val === '1' ? '' : 's'}`
      : `${val}ms`;
    return `${prefix}: ${thing} responded in under ${unit}`;
  }
  // Default: capitalize first letter of description
  return `${prefix}: ${desc.charAt(0).toUpperCase() + desc.slice(1)}`;
}

function humanizeCondition(metric, condition) {
  const m = condition.match(/^([a-z_]+(?:\(\d+(?:\.\d+)?\))?)\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return condition;
  const [, stat, op, rawVal] = m;
  const val = parseFloat(rawVal);
  const opWord = { '<': 'under', '<=': 'at most', '>': 'above', '>=': 'at least' }[op] || op;
  function fmt2(n) {
    const s = n.toFixed(2).replace(/\.?0+$/, '');
    const [int, dec] = s.split('.');
    return (dec ? `${Number(int).toLocaleString('en-US')}.${dec}` : Number(int).toLocaleString('en-US'));
  }
  let fv;
  if (stat === 'rate') {
    fv = fmt2(val * 100) + '%';
  } else if (stat === 'count' || stat === 'value') {
    fv = Math.round(val).toLocaleString('en-US');
  } else {
    fv = val >= 1000 ? `${fmt2(val / 1000)} seconds` : `${fmt2(val)} ms`;
  }
  if (stat.startsWith('p(')) {
    const n = stat.match(/\d+/)[0];
    return `${n}% of requests completed in ${opWord} ${fv}`;
  }
  if (stat === 'avg')   return `average response time ${opWord} ${fv}`;
  if (stat === 'med')   return `median response time ${opWord} ${fv}`;
  if (stat === 'max')   return `max response time ${opWord} ${fv}`;
  if (stat === 'min')   return `min response time ${opWord} ${fv}`;
  if (stat === 'rate')  return `rate ${opWord} ${fv}`;
  if (stat === 'count') return `count ${opWord} ${fv}`;
  if (stat === 'value') return `value ${opWord} ${fv}`;
  return condition;
}

function friendlyMetricName(name) {
  return name
    .replace('http_req_duration', 'Response time')
    .replace('http_req_failed',   'Error rate')
    .replace('login_success_rate','Login success rate')
    .replace('page_load_time',    'Page load time')
    .replace('response_trend_ms', 'Response trend')
    .replace('session_error_rate','Session error rate')
    .replace('{scenario:browsing_users}', ' (browsing users)')
    .replace('{scenario:api_readers}',   ' (API readers)')
    .replace('{scenario:constant_load}', ' (constant load)')
    .replace('{page:home}',    ' - homepage')
    .replace('{page:login}',   ' - login')
    .replace('{page:messages}',' - messages');
}

module.exports = { generateReport };
