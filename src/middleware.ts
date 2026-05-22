import { trackedAI } from './wrappers';

export function withTracking<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: { provider: string; model: string; tokenExtractor?: (res: TResult) => { promptTokens: number; completionTokens: number } }
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    return trackedAI(
      options.provider,
      options.model,
      () => fn(...args),
      options.tokenExtractor || ((res: any) => ({
        promptTokens: res.usage?.prompt_tokens || res.usage?.input_tokens || 0,
        completionTokens: res.usage?.completion_tokens || res.usage?.output_tokens || 0
      }))
    );
  };
}

export class BatchTracker {
  constructor(private provider: string, private model: string) {}
  
  track<T>(
    apiCall: () => Promise<T>,
    tokenExtractor?: (res: T) => { promptTokens: number; completionTokens: number }
  ): Promise<T> {
    return trackedAI(
      this.provider,
      this.model,
      apiCall,
      tokenExtractor || ((res: any) => ({
        promptTokens: res.usage?.prompt_tokens || res.usage?.input_tokens || 0,
        completionTokens: res.usage?.completion_tokens || res.usage?.output_tokens || 0
      }))
    );
  }
}

export function createTrackedClient(client: any, options: { provider: string; model: string }) {
  // A simple proxy pattern
  return new Proxy(client, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig === 'function') {
        return withTracking(orig.bind(target), options);
      }
      return orig;
    }
  });
}
