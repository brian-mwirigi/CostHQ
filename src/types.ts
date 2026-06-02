export interface Session {
  id?: number;
  name: string;
  startTime: string;
  endTime?: string;
  duration?: number; // in seconds
  workingDirectory: string;
  gitRoot?: string;
  startGitHead?: string;
  filesChanged: number;
  commits: number;
  aiCost: number;
  aiTokens: number;
  notes?: string;
  status: 'active' | 'completed';
}

export interface FileChange {
  id?: number;
  sessionId: number;
  filePath: string;
  changeType: 'created' | 'modified' | 'deleted';
  timestamp: string;
}

export interface Commit {
  id?: number;
  sessionId: number;
  hash: string;
  message: string;
  timestamp: string;
}

export interface AIUsage {
  id?: number;
  sessionId: number;
  provider: string;
  model: string;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  cost: number;
  durationSeconds?: number;   // compute time for local models
  agentName?: string;
  timestamp: string;
}

export interface SessionStats {
  totalSessions: number;
  totalTime: number;
  totalFiles: number;
  totalCommits: number;
  totalAICost: number;
  avgSessionTime: number;
}

export interface SessionNote {
  id?: number;
  sessionId: number;
  message: string;
  timestamp: string;
}
