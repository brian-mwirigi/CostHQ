import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getSession, getAIUsage, getFileChanges, getCommits } from './db';
import { formatDuration } from './formatters';

function escapeHtml(unsafe: string): string {
  return (unsafe || '').toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function exportSessionToPDF(sessionId: number, outputPath?: string) {
  const session = getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`\n[ERROR] Session ${sessionId} not found.`));
    return;
  }

  const aiUsage = getAIUsage(sessionId);
  const files = getFileChanges(sessionId);
  const commits = getCommits(sessionId);

  const outPath = outputPath || path.join(process.cwd(), `CostHQ-receipt-${sessionId}.pdf`);

  console.log(chalk.blue(`\nGenerating professional invoice for session ${sessionId}...`));

  // Generate HTML
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Session Invoice</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
        .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #eaeaea; padding-bottom: 20px; margin-bottom: 30px; }
        .logo { font-size: 24px; font-weight: bold; color: #111; letter-spacing: -0.5px; }
        .logo span { color: #3b82f6; }
        .invoice-details { text-align: right; font-size: 14px; color: #666; }
        h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; }
        .summary-cards { display: flex; gap: 20px; margin-bottom: 40px; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; flex: 1; }
        .card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 5px; }
        .card-value { font-size: 24px; font-weight: bold; color: #0f172a; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th { text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 13px; text-transform: uppercase; }
        td { padding: 12px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 14px; }
        .cost-col { text-align: right; font-weight: 500; }
        .total-row td { border-bottom: none; font-weight: bold; color: #0f172a; border-top: 2px solid #e2e8f0; }
        .footer { margin-top: 50px; font-size: 12px; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">code<span>session</span></div>
        <div class="invoice-details">
          <div>Receipt #CS-${session.id}</div>
          <div>Date: ${new Date(session.endTime || session.startTime).toLocaleDateString()}</div>
        </div>
      </div>

      <h1>Session Overview: ${escapeHtml(session.name)}</h1>
      
      <div class="summary-cards">
        <div class="card">
          <div class="card-title">Duration</div>
          <div class="card-value">${formatDuration(session.duration || 0)}</div>
        </div>
        <div class="card">
          <div class="card-title">Files Changed</div>
          <div class="card-value">${session.filesChanged || 0}</div>
        </div>
        <div class="card">
          <div class="card-title">Commits</div>
          <div class="card-value">${session.commits || 0}</div>
        </div>
        <div class="card">
          <div class="card-title">Total AI Cost</div>
          <div class="card-value" style="color: #3b82f6">$${(session.aiCost || 0).toFixed(4)}</div>
        </div>
      </div>

      <h2>AI Usage Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th>Tokens</th>
            <th class="cost-col">Cost</th>
          </tr>
        </thead>
        <tbody>
          ${aiUsage.map(u => `
            <tr>
              <td><span style="text-transform: capitalize">${escapeHtml(u.provider)}</span></td>
              <td>${escapeHtml(u.model)}</td>
              <td>${u.tokens.toLocaleString()}</td>
              <td class="cost-col">$${u.cost.toFixed(4)}</td>
            </tr>
          `).join('')}
          ${aiUsage.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: #94a3b8">No AI API calls logged in this session.</td></tr>' : ''}
          <tr class="total-row">
            <td colspan="3" style="text-align: right">Total Due</td>
            <td class="cost-col">$${(session.aiCost || 0).toFixed(4)}</td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        Generated automatically by CostHQ CLI
      </div>
    </body>
    </html>
  `;

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    await browser.close();
    console.log(chalk.green(`✅ PDF Exported successfully to:\n   ${outPath}`));
  } catch (error: any) {
    console.error(chalk.red(`\n[ERROR] Failed to generate PDF: ${error.message}`));
    console.error(chalk.yellow(`Make sure you have Chrome or Chromium installed, or run 'npx puppeteer browsers install chrome'.`));
  }
}
