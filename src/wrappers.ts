import { calculateCost, ensureTrackingSession, addAIUsage, addNote } from './db';

// A generic wrapper function for AI token tracking
export async function trackedAI<T>(
  provider: string,
  model: string,
  apiCall: () => Promise<T>,
  tokenExtractor: (res: T) => { promptTokens: number; completionTokens: number },
  notes?: string
): Promise<T> {
  let tokens = { promptTokens: 0, completionTokens: 0 };
  let result: T;
  try {
    result = await apiCall();
    tokens = tokenExtractor(result);
  } catch (err: any) {
    try { tokens = tokenExtractor(err); } catch {}
    if (tokens.promptTokens > 0 || tokens.completionTokens > 0) {
      const cost = calculateCost(provider, model, tokens.promptTokens, tokens.completionTokens);
      const sessionId = ensureTrackingSession(process.cwd());
      addAIUsage({
        sessionId, provider, model, tokens: tokens.promptTokens + tokens.completionTokens,
        promptTokens: tokens.promptTokens, completionTokens: tokens.completionTokens,
        cost, timestamp: new Date().toISOString(),
      });
      if (notes) {
        addNote(sessionId, notes);
      }
    }
    throw err;
  }

  const cost = calculateCost(provider, model, tokens.promptTokens, tokens.completionTokens);
  const sessionId = ensureTrackingSession(process.cwd());
  
  addAIUsage({
    sessionId, provider, model, tokens: tokens.promptTokens + tokens.completionTokens,
    promptTokens: tokens.promptTokens, completionTokens: tokens.completionTokens,
    cost, timestamp: new Date().toISOString(),
  });
  
  if (notes) {
    addNote(sessionId, notes);
  }
  
  return result;
}

export async function trackedGPT<T = any>(client: any, options: any, notes?: string): Promise<T> {
  return trackedAI(
    'openai',
    options.model || 'gpt-4o',
    async () => client.chat.completions.create(options),
    (res: any) => ({
      promptTokens: res.usage?.prompt_tokens || 0,
      completionTokens: res.usage?.completion_tokens || 0,
    }),
    notes
  );
}

export async function trackedClaude<T = any>(client: any, options: any, notes?: string): Promise<T> {
  return trackedAI(
    'anthropic',
    options.model || 'claude-3-5-sonnet',
    async () => client.messages.create(options),
    (res: any) => ({
      promptTokens: res.usage?.input_tokens || 0,
      completionTokens: res.usage?.output_tokens || 0,
    }),
    notes
  );
}

export async function trackedGemini<T = any>(client: any, options: any, notes?: string): Promise<T> {
  return trackedAI(
    'google',
    options.model || 'gemini-1.5-pro',
    async () => client.getGenerativeModel({ model: options.model }).generateContent(options),
    (res: any) => ({
      promptTokens: res.response?.usageMetadata?.promptTokenCount || 0,
      completionTokens: res.response?.usageMetadata?.candidatesTokenCount || 0,
    }),
    notes
  );
}
