# Quickstart: Node.js + OpenAI

Integrate CostHQ into your existing Node.js app in under 2 minutes. This drop-in replacement automatically tracks prompt and completion tokens for every request, calculates the cost based on our built-in pricing engine, and sends the data to your local CostHQ dashboard.

## 1. Install

```bash
npm install costhq openai
```

## 2. Drop-in Replacement

Replace your standard `OpenAI` client with `TrackedOpenAI` from CostHQ. It extends the official SDK, so you don't have to change any of your existing code.

```typescript
import { TrackedOpenAI } from 'costhq/extensions';

// Initialize exactly as you would with the official SDK
const openai = new TrackedOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function run() {
  console.log("Generating response...");
  
  // Your API calls are automatically intercepted, tracked, and cost-calculated!
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Explain semantic caching.' }],
  });

  console.log(response.choices[0].message.content);
}

run();
```

## 3. View Your Dashboard

Run the CostHQ dashboard to instantly see your spend, session summaries, and model utilization:

```bash
cs dashboard
```
