#!/usr/bin/env tsx
/**
 * Devnet Load Report Generator
 *
 * Generates a markdown report from telemetry data.
 *
 * Usage:
 *   npm run devnet:report -- --run-id=devnet-load-xxx
 *   npm run devnet:report  # Uses latest data
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {} as Record<string, string>);

const RUN_ID = args['run-id'] || `report-${Date.now()}`;
const OUTPUT_DIR = args['output'] || path.join(__dirname, '..', '..');

async function generateReport(): Promise<void> {
  console.log('Generating Devnet Readiness Load Report...');

  try {
    const { initDatabase, getDevnetStats, getRequestLogStats, getRecentTxHashes, migrateAddFeeColumns } = await import('../telemetry/db');
    const { BLOSSOM_FEE_BPS } = await import('../src/config');

    initDatabase();
    migrateAddFeeColumns();

    const stats = getDevnetStats(BLOSSOM_FEE_BPS);
    const requestStats = getRequestLogStats(RUN_ID);
    const recentTxHashes = getRecentTxHashes(20);

    const now = new Date();
    const reportFileName = `DEVNET_LOAD_REPORT_${RUN_ID}.md`;
    const reportPath = path.join(OUTPUT_DIR, reportFileName);

    // Calculate success rate
    const totalOk = requestStats.byEndpoint.reduce((sum, e) => sum + e.successCount, 0);
    const totalRequests = requestStats.totalRequests;
    const successRate = totalRequests > 0 ? ((totalOk / totalRequests) * 100).toFixed(2) : '0.00';

    // Calculate overall latency
    const allLatencies = requestStats.byEndpoint.flatMap(e => [e.avgLatencyMs, e.p95LatencyMs]).filter(l => l > 0);
    const overallP50 = allLatencies.length > 0 ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length) : 0;
    const overallP95 = Math.max(...requestStats.byEndpoint.map(e => e.p95LatencyMs), 0);

    const report = `# Devnet Readiness Load Report

**Report ID:** ${RUN_ID}
**Generated:** ${now.toISOString()}
**Environment:** ${process.env.EXECUTION_MODE || 'eth_testnet'}

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Requests | ${totalRequests.toLocaleString()} |
| Success Rate | ${successRate}% |
| P50 Latency | ${overallP50}ms |
| P95 Latency | ${overallP95}ms |
| HTTP 5xx Errors | ${requestStats.http5xxCount} |
| Unique Devnet Users | ${stats.users.allTime.toLocaleString()} |
| Total Transactions | ${stats.transactions.allTime.toLocaleString()} |

---

## 1. Unique Devnet Users

| Metric | Count |
|--------|-------|
| All-Time | ${stats.users.allTime.toLocaleString()} |
| Last 24h | ${stats.users.last24h.toLocaleString()} |

---

## 2. Processed Transactions

| Metric | Count |
|--------|-------|
| All-Time | ${stats.transactions.allTime.toLocaleString()} |
| Last 24h | ${stats.transactions.last24h.toLocaleString()} |
| Success | ${stats.transactions.successCount.toLocaleString()} |
| Failed | ${stats.transactions.failCount.toLocaleString()} |

**Success Rate:** ${stats.transactions.allTime > 0 ? ((stats.transactions.successCount / stats.transactions.allTime) * 100).toFixed(2) : '0.00'}%

---

## 3. Total Devnet Amount Executed

${stats.amountExecuted.byToken.length > 0 ? `
| Token | Total Units |
|-------|-------------|
${stats.amountExecuted.byToken.map(t => `| ${t.token} | ${t.totalUnits} |`).join('\n')}
` : '*No priced volume data available*'}

${stats.amountExecuted.unpricedCount > 0 ? `\n*Note: ${stats.amountExecuted.unpricedCount} executions without amount/token data*` : ''}

---

## 4. Devnet Fees Collected

**Current Fee Rate:** ${stats.feesCollected.feeBps} bps (${(stats.feesCollected.feeBps / 100).toFixed(2)}%)

${stats.feesCollected.byToken.length > 0 ? `
| Token | All-Time Fees | Last 24h Fees |
|-------|---------------|---------------|
${stats.feesCollected.byToken.map(t => `| ${t.token} | ${t.totalFeeUnits} | ${t.last24hFeeUnits} |`).join('\n')}
` : '*No fee data available*'}

${stats.feesCollected.unpricedCount > 0 ? `\n*Note: ${stats.feesCollected.unpricedCount} successful executions without fee calculation*` : ''}

---

## 5. Per-Route Performance

| Endpoint | Total | Success | Fail | Success% | Avg (ms) | P95 (ms) |
|----------|-------|---------|------|----------|----------|----------|
${requestStats.byEndpoint.map(e => {
  const failCount = e.count - e.successCount;
  const successPct = e.count > 0 ? ((e.successCount / e.count) * 100).toFixed(1) : '0.0';
  return `| ${e.endpoint} | ${e.count} | ${e.successCount} | ${failCount} | ${successPct}% | ${e.avgLatencyMs} | ${e.p95LatencyMs} |`;
}).join('\n')}

---

## 6. Error Analysis

**HTTP 5xx Count:** ${requestStats.http5xxCount}

${requestStats.errorCodes.length > 0 ? `
### Top Error Codes

| Error Code | Count |
|------------|-------|
${requestStats.errorCodes.map(e => `| ${e.code} | ${e.count} |`).join('\n')}
` : '*No errors recorded*'}

---

## 7. Recent Transaction Hashes

${recentTxHashes.length > 0 ? `
\`\`\`
${recentTxHashes.join('\n')}
\`\`\`
` : '*No transaction hashes recorded*'}

---

## 8. Configuration

| Setting | Value |
|---------|-------|
| Fee BPS | ${stats.feesCollected.feeBps} |
| Mode | ${process.env.EXECUTION_MODE || 'eth_testnet'} |
| Report Generated | ${now.toISOString()} |

---

## Readiness Assessment

${(() => {
  const issues: string[] = [];

  if (parseFloat(successRate) < 99) {
    issues.push(`- Success rate (${successRate}%) below 99% threshold`);
  }
  if (requestStats.http5xxCount > 0) {
    issues.push(`- ${requestStats.http5xxCount} HTTP 5xx errors detected`);
  }
  if (overallP95 > 500) {
    issues.push(`- P95 latency (${overallP95}ms) exceeds 500ms target`);
  }
  if (stats.users.allTime < 1000) {
    issues.push(`- User count (${stats.users.allTime}) below 1000 target`);
  }

  if (issues.length === 0) {
    return '**Status: READY FOR LAUNCH**\n\nAll metrics meet production thresholds.';
  } else {
    return `**Status: REVIEW REQUIRED**\n\n${issues.join('\n')}`;
  }
})()}

---

*Report generated by Blossom Devnet Load Test Suite*
`;

    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved to: ${reportPath}`);
    console.log('\n--- REPORT PREVIEW ---\n');
    console.log(report.substring(0, 2000) + '\n...\n');

  } catch (error) {
    console.error('Failed to generate report:', error);
    process.exit(1);
  }
}

// Run
generateReport().catch(console.error);
