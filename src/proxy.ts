import express from 'express';
import { createHash } from 'crypto';
import chalk from 'chalk';
import { getProxyCache, setProxyCache, recordProxyCacheHit } from './db';
import { loadPricing } from './db';
import { getProPolicy } from '../pro/src/policies';

const app = express();

// Parse raw body to preserve exact JSON for hashing
app.use(express.raw({ type: 'application/json' }));

function hashRequest(body: Buffer, authHeader?: string): string {
  return createHash('sha256')
    .update(body)
    .update(authHeader || '')
    .digest('hex');
}

function calculateOpenAICost(usage: any, model: string, pricing: Record<string, { input: number; output: number }>): number {
  if (!usage) return 0;
  
  // Try to find exact model or fallback
  let rate = pricing[model];
  if (!rate) {
    const fallbackModel = Object.keys(pricing).sort((a, b) => b.length - a.length).find(k => model.includes(k));
    if (fallbackModel) {
      rate = pricing[fallbackModel];
    }
  }

  if (rate) {
    const promptCost = ((usage.prompt_tokens || 0) / 1000000) * rate.input;
    const completionCost = ((usage.completion_tokens || 0) / 1000000) * rate.output;
    return promptCost + completionCost;
  }
  return 0;
}

app.use(async (req, res) => {
  let targetUrl = '';
  let provider = '';

  // Determine upstream target based on the path prefix
  if (req.path.startsWith('/openai/')) {
    targetUrl = 'https://api.openai.com' + req.path.replace('/openai', '');
    provider = 'openai';
  } else if (req.path.startsWith('/anthropic/')) {
    targetUrl = 'https://api.anthropic.com' + req.path.replace('/anthropic', '');
    provider = 'anthropic';
  } else {
    // Default to OpenAI if no prefix is provided (many libraries assume standard /v1)
    targetUrl = 'https://api.openai.com' + req.path;
    provider = 'openai';
  }

  const authHeader = req.headers['authorization'] || req.headers['x-api-key'] as string;
  const bodyBuffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body || '');
  const reqHash = hashRequest(bodyBuffer, authHeader);

  const policy = getProPolicy();

  // Check Semantic Cache (only for POST requests like completions)
  if (policy.cacheEnabled && req.method === 'POST') {
    const cached = getProxyCache(reqHash);
    if (cached) {
      recordProxyCacheHit(reqHash, cached.cost);
      console.log(chalk.green(`[CACHE HIT] served from local cache. Saved $${cached.cost.toFixed(4)}`));
      res.setHeader('X-CostHQ-Cache', 'HIT');
      res.setHeader('X-CostHQ-Saved-Cost', cached.cost.toFixed(6));
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(cached.response);
    }
  }

  console.log(chalk.gray(`[PROXY] Forwarding to ${targetUrl}...`));

  try {
    // Forward headers but remove host and content-length to avoid issues
    const headers = { ...req.headers } as Record<string, string>;
    delete headers['host'];
    delete headers['content-length'];

    const fetchRes = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? bodyBuffer : undefined,
    });

    const resBody = await fetchRes.text();
    
    // Copy headers back to client
    fetchRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.setHeader('X-CostHQ-Cache', 'MISS');
    res.status(fetchRes.status);
    res.send(resBody);

    // If it was a successful POST, cache it
    if (policy.cacheEnabled && req.method === 'POST' && fetchRes.status === 200) {
      try {
        const json = JSON.parse(resBody);
        let cost = 0;
        const pricing = loadPricing();
        if (json.usage && json.model) {
           cost = calculateOpenAICost(json.usage, json.model, pricing);
        }
        setProxyCache(reqHash, resBody, cost);
        console.log(chalk.blue(`[CACHE MISS] Cached response for future use. Actual cost: $${cost.toFixed(4)}`));
      } catch (e) {
        // Not JSON or missing usage data, skip caching
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`[PROXY ERROR] ${err.message}`));
    res.status(500).json({ error: 'Proxy request failed', details: err.message });
  }
});

export function startProxy(port: number = 3739) {
  app.listen(port, '127.0.0.1', () => {
    console.log(chalk.cyan(`
🚀 CostHQ Semantic Caching Proxy running on http://127.0.0.1:${port}
    
To use with OpenAI clients, set:
  OPENAI_BASE_URL=http://127.0.0.1:${port}/openai/v1
  
To use with Anthropic clients, set:
  ANTHROPIC_BASE_URL=http://127.0.0.1:${port}/anthropic/v1
    
Any duplicate identical requests will be served locally for $0.00!
`));
  });
}
