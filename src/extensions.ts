import { trackedGPT, trackedClaude, trackedGemini } from './wrappers';

export class TrackedOpenAI {
  public chat: { completions: { create: (options: any) => Promise<any> } };
  
  constructor(options: any) {
    let OpenAI: any;
    try { OpenAI = require('openai').default || require('openai'); } 
    catch { throw new Error("Please install 'openai' to use TrackedOpenAI"); }
    
    const client = new OpenAI(options);
    this.chat = {
      completions: {
        create: async (opts: any) => trackedGPT(client, opts)
      }
    };
  }
}

export class TrackedAnthropic {
  public messages: { create: (options: any) => Promise<any> };
  
  constructor(options: any) {
    let Anthropic: any;
    try { Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk'); } 
    catch { throw new Error("Please install '@anthropic-ai/sdk' to use TrackedAnthropic"); }
    
    const client = new Anthropic(options);
    this.messages = {
      create: async (opts: any) => trackedClaude(client, opts)
    };
  }
}

export class TrackedGoogleAI {
  private client: any;
  
  constructor(apiKey: string) {
    let GoogleGenAI: any;
    try { GoogleGenAI = require('@google/generative-ai').GoogleGenerativeAI; } 
    catch { throw new Error("Please install '@google/generative-ai' to use TrackedGoogleAI"); }
    
    this.client = new GoogleGenAI(apiKey);
  }
  
  getGenerativeModel(options: any) {
    return {
      generateContent: async (opts: any) => trackedGemini(this.client, { model: options.model, ...opts })
    };
  }
}
