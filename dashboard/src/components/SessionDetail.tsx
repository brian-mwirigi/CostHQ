import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchApi, fetchDiff, fetchCommitDiff, fetchDiffStats } from '../api';
import type { DiffStat } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatDuration, formatDate, formatTokens } from '../utils/format';
import { IconArrowLeft, IconFolder, IconCalendar, IconToken, IconDollar, IconHash, IconClock, IconGitBranch } from './Icons';

interface FileChange {
  filePath: string;
  changeType: string;
  timestamp: string;
}

interface Commit {
  hash: string;
  message: string;
  timestamp: string;
}

interface AiUsage {
  provider: string;
  model: string;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  cost: number;
  agentName?: string;
  timestamp: string;
}

interface Note {
  message: string;
  timestamp: string;
}

interface SessionInfo {
  id: number;
  name: string;
  status: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  workingDirectory: string;
  filesChanged: number;
  commits: number;
  aiTokens: number;
  aiCost: number;
  startGitHead?: string;
  notes?: string;
}

interface SessionDetailResponse {
  session: SessionInfo;
  aiUsage: AiUsage[];
  files: FileChange[];
  commits: Commit[];
  notes: Note[];
}

interface TimelineEntry {
  type: 'file' | 'commit' | 'ai' | 'note';
  timestamp: string;
  data: FileChange | Commit | AiUsage | Note;
}

interface Props {
  sessionId: number;
  onBack: () => void;
}

export default function SessionDetail({ sessionId, onBack }: Props) {
  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [tab, setTab] = useState<'timeline' | 'files' | 'commits' | 'ai' | 'notes'>('timeline');

  useEffect(() => {
    fetchData();
  }, [sessionId]);

  const fetchData = useCallback(() => {
    fetchApi<SessionDetailResponse>(`/api/sessions/${sessionId}`).then(setData);
  }, [sessionId]);

  useInterval(fetchData, 30_000);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!data) return [];
    const entries: TimelineEntry[] = [];
    data.files?.forEach(f => entries.push({ type: 'file', timestamp: f.timestamp, data: f }));
    data.commits?.forEach(c => entries.push({ type: 'commit', timestamp: c.timestamp, data: c }));
    data.aiUsage?.forEach(a => entries.push({ type: 'ai', timestamp: a.timestamp, data: a }));
    data.notes?.forEach(n => entries.push({ type: 'note', timestamp: n.timestamp, data: n }));
    return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [data]);

  if (!data) return <div className="page"><div className="loading">Loading session…</div></div>;

  const session = data.session;
  const costPerHour = session.duration && session.duration > 0 ? session.aiCost / (session.duration / 3600) : null;
  const promptTokens = data.aiUsage?.reduce((s, a) => s + (a.promptTokens || 0), 0) || 0;
  const completionTokens = data.aiUsage?.reduce((s, a) => s + (a.completionTokens || 0), 0) || 0;
  const ratio = promptTokens > 0 ? (completionTokens / promptTokens).toFixed(2) : '—';

  const tabs = [
    { key: 'timeline', label: 'Timeline', count: timeline.length },
    { key: 'files', label: 'Files', count: data.files?.length || 0 },
    { key: 'commits', label: 'Commits', count: data.commits?.length || 0 },
    { key: 'ai', label: 'AI Calls', count: data.aiUsage?.length || 0 },
    { key: 'notes', label: 'Notes', count: data.notes?.length || 0 },
  ] as const;

  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}>
        <IconArrowLeft size={14} /> All Sessions
      </button>

      <div className="page-header">
        <h1 className="page-title">{session.name}</h1>
        <div className="page-subtitle">
          <span className={`badge badge-${session.status}`}>{session.status}</span>
        </div>
      </div>

      {/* Stat Row */}
      <div className="stat-row">
        <div className="stat-cell">
          <span className="stat-label"><IconCalendar size={13} /> Started</span>
          <span className="stat-value mono">{formatDate(session.startTime)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconClock size={13} /> Duration</span>
          <span className="stat-value mono">{formatDuration(session.duration)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconDollar size={13} /> Total Cost</span>
          <span className="stat-value mono cost">{formatCost(session.aiCost)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconDollar size={13} /> Cost/hr</span>
          <span className="stat-value mono">{costPerHour ? formatCost(costPerHour) : '—'}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconToken size={13} /> Tokens</span>
          <span className="stat-value mono">{formatTokens(session.aiTokens)}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconHash size={13} /> Prompt:Compl</span>
          <span className="stat-value mono">{ratio}x</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconFolder size={13} /> Files</span>
          <span className="stat-value mono">{session.filesChanged}</span>
        </div>
        <div className="stat-cell">
          <span className="stat-label"><IconGitBranch size={13} /> Commits</span>
          <span className="stat-value mono">{session.commits}</span>
        </div>
      </div>

      {/* Meta */}
      <div className="detail-meta">
        {session.workingDirectory && (
          <div className="meta-item">
            <span className="meta-label">Working Directory</span>
            <span className="meta-value mono">{session.workingDirectory}</span>
          </div>
        )}
        {session.startGitHead && (
          <div className="meta-item">
            <span className="meta-label">Git HEAD at start</span>
            <span className="meta-value mono">{session.startGitHead}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab-btn${tab === t.key ? ' tab-btn--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card">
        <div className="card-body--flush">
          {tab === 'timeline' && <TimelineView entries={timeline} />}
          {tab === 'files' && <FilesTable files={data.files || []} sessionId={sessionId} />}
          {tab === 'commits' && <CommitsTable commits={data.commits || []} sessionId={sessionId} />}
          {tab === 'ai' && <AiTable usage={data.aiUsage || []} />}
          {tab === 'notes' && <NotesTable notes={data.notes || []} />}
        </div>
      </div>
    </div>
  );
}

function TimelineView({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <div className="empty-state">No activity recorded</div>;

  const typeLabel: Record<string, string> = { file: 'File', commit: 'Commit', ai: 'AI', note: 'Note' };

  return (
    <div className="timeline">
      {entries.map((e, i) => (
        <div key={i} className={`timeline-item timeline-item--${e.type}`}>
          <div className="timeline-marker" />
          <div className="timeline-content">
            <div className="timeline-header">
              <span className={`timeline-badge timeline-badge--${e.type}`}>{typeLabel[e.type]}</span>
              <span className="timeline-time mono">{formatDate(e.timestamp)}</span>
            </div>
            <div className="timeline-body">
              {e.type === 'file' && (() => {
                const f = e.data as FileChange;
                return <span className="mono"><span className={`badge badge-file-${f.changeType}`}>{f.changeType}</span> {f.filePath}</span>;
              })()}
              {e.type === 'commit' && (() => {
                const c = e.data as Commit;
                return <span><span className="mono hash">{c.hash.slice(0, 7)}</span> {c.message}</span>;
              })()}
              {e.type === 'ai' && (() => {
                const a = e.data as AiUsage;
                const agentStr = a.agentName ? ` [${a.agentName}]` : '';
                return <span>{a.provider}/{a.model}{agentStr} — {formatTokens(a.tokens)} tokens — {formatCost(a.cost)}</span>;
              })()}
              {e.type === 'note' && <span>{(e.data as Note).message}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilesTable({ files, sessionId }: { files: FileChange[]; sessionId: number }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [diffStats, setDiffStats] = useState<Record<string, DiffStat>>({});

  // Fetch diff stats once
  useEffect(() => {
    fetchDiffStats(sessionId).then((stats) => {
      const map: Record<string, DiffStat> = {};
      for (const s of stats) map[s.filePath] = s;
      setDiffStats(map);
    }).catch(() => {});
  }, [sessionId]);

  const toggleDiff = useCallback(async (filePath: string) => {
    if (expandedFile === filePath) {
      setExpandedFile(null);
      setDiffText('');
      return;
    }
    setExpandedFile(filePath);
    setLoading(true);
    try {
      const text = await fetchDiff(sessionId, filePath);
      setDiffText(text);
    } catch (err: any) {
      setDiffText(`(failed to load diff: ${err.message || 'unknown error'})`);
    }
    setLoading(false);
  }, [expandedFile, sessionId]);

  // Summary totals
  const totalAdd = Object.values(diffStats).reduce((s, d) => s + d.additions, 0);
  const totalDel = Object.values(diffStats).reduce((s, d) => s + d.deletions, 0);

  if (files.length === 0) return <div className="empty-state">No file changes recorded</div>;

  // Split file path into directory + filename
  const splitPath = (p: string) => {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (idx < 0) return { dir: '', name: p };
    return { dir: p.slice(0, idx + 1), name: p.slice(idx + 1) };
  };

  return (
    <div>
      {/* Summary bar like GitHub PR */}
      {totalAdd + totalDel > 0 && (
        <div className="diff-summary">
          <span className="diff-summary-text">
            Showing <strong>{files.length}</strong> changed file{files.length !== 1 ? 's' : ''} with{' '}
            <strong className="diff-add-text">+{totalAdd.toLocaleString()}</strong> addition{totalAdd !== 1 ? 's' : ''} and{' '}
            <strong className="diff-del-text">-{totalDel.toLocaleString()}</strong> deletion{totalDel !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>File</th>
            <th>Type</th>
            <th className="r">Changes</th>
            <th className="r">Time</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f, i) => {
            const stat = diffStats[f.filePath];
            const { dir, name } = splitPath(f.filePath);
            const add = stat?.additions || 0;
            const del = stat?.deletions || 0;
            const total = add + del;
            const maxBlocks = 5;
            const addBlocks = total > 0 ? Math.round((add / total) * maxBlocks) : 0;
            const delBlocks = total > 0 ? maxBlocks - addBlocks : 0;

            return (
              <>
                <tr key={i} className="clickable-row" onClick={() => toggleDiff(f.filePath)} title="Click to view diff">
                  <td className="mono ellipsis" title={f.filePath}>
                    <span className="diff-toggle" aria-hidden="true">{expandedFile === f.filePath ? '\u25BC' : '\u25B6'}</span>
                    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>
                      {expandedFile === f.filePath ? 'Collapse diff' : 'Expand diff'}
                    </span>
                    {' '}{dir && <span className="file-dir">{dir}</span>}<strong>{name}</strong>
                  </td>
                  <td><span className={`badge badge-file-${f.changeType}`}>{f.changeType}</span></td>
                  <td className="r mono diff-stat-cell">
                    {stat ? (
                      <>
                        <span className="diff-add-text">+{add}</span>{' '}
                        <span className="diff-del-text">-{del}</span>{' '}
                        <span className="diff-bar">
                          {Array.from({ length: addBlocks }).map((_, j) => (
                            <span key={`a${j}`} className="diff-block diff-block--add" />
                          ))}
                          {Array.from({ length: delBlocks }).map((_, j) => (
                            <span key={`d${j}`} className="diff-block diff-block--del" />
                          ))}
                        </span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="r mono">{formatDate(f.timestamp)}</td>
                </tr>
                {expandedFile === f.filePath && (
                  <tr key={`diff-${i}`}>
                    <td colSpan={4} className="diff-cell">
                      {loading ? <div className="diff-loading">Loading diff...</div> : <DiffView diff={diffText} />}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CommitsTable({ commits, sessionId }: { commits: Commit[]; sessionId: number }) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const toggleDiff = useCallback(async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      setDiffText('');
      return;
    }
    setExpandedHash(hash);
    setLoading(true);
    try {
      const text = await fetchCommitDiff(sessionId, hash);
      setDiffText(text);
    } catch (err: any) {
      setDiffText(`(failed to load diff: ${err.message || 'unknown error'})`);
    }
    setLoading(false);
  }, [expandedHash, sessionId]);

  if (commits.length === 0) return <div className="empty-state">No commits recorded</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Hash</th>
          <th>Message</th>
          <th className="r">Time</th>
        </tr>
      </thead>
      <tbody>
        {commits.map((c, i) => (
          <>
            <tr key={i} className="clickable-row" onClick={() => toggleDiff(c.hash)} title="Click to view diff">
              <td className="mono hash">
                <span className="diff-toggle" aria-hidden="true">{expandedHash === c.hash ? '\u25BC' : '\u25B6'}</span>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>
                  {expandedHash === c.hash ? 'Collapse diff' : 'Expand diff'}
                </span>
                {' '}{c.hash.slice(0, 7)}
              </td>
              <td className="ellipsis" title={c.message}>{c.message}</td>
              <td className="r mono">{formatDate(c.timestamp)}</td>
            </tr>
            {expandedHash === c.hash && (
              <tr key={`diff-${i}`}>
                <td colSpan={3} className="diff-cell">
                  {loading ? <div className="diff-loading">Loading diff...</div> : <DiffView diff={diffText} />}
                </td>
              </tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}

function AiTable({ usage }: { usage: AiUsage[] }) {
  if (usage.length === 0) return <div className="empty-state">No AI usage recorded</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Model</th>
          <th>Agent</th>
          <th className="r">Prompt</th>
          <th className="r">Completion</th>
          <th className="r">Total</th>
          <th className="r">Cost</th>
          <th className="r">Time</th>
        </tr>
      </thead>
      <tbody>
        {usage.map((a, i) => (
          <tr key={i}>
            <td className="mono">{a.provider}</td>
            <td className="mono">{a.model}</td>
            <td className="mono">{a.agentName || '—'}</td>
            <td className="r mono">{formatTokens(a.promptTokens)}</td>
            <td className="r mono">{formatTokens(a.completionTokens)}</td>
            <td className="r mono">{formatTokens(a.tokens)}</td>
            <td className="r mono cost">{formatCost(a.cost)}</td>
            <td className="r mono">{formatDate(a.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NotesTable({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return <div className="empty-state">No notes recorded</div>;
  return (
    <div className="notes-list">
      {notes.map((n, i) => (
        <div key={i} className="note-item">
          <div className="note-time mono">{formatDate(n.timestamp)}</div>
          <div className="note-text">{n.message}</div>
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  if (!diff || diff === '(no changes)' || diff.startsWith('(failed to load diff')) {
    return <div className="diff-empty">{diff || '(no changes)'}</div>;
  }

  const lines = diff.split('\n');

  return (
    <div className="diff-viewer">
      <pre className="diff-pre">
        {lines.map((line, i) => {
          let cls = 'diff-line';
          if (line.startsWith('+++') || line.startsWith('---')) cls += ' diff-line--meta';
          else if (line.startsWith('@@')) cls += ' diff-line--hunk';
          else if (line.startsWith('+')) cls += ' diff-line--add';
          else if (line.startsWith('-')) cls += ' diff-line--del';
          else if (line.startsWith('diff ')) cls += ' diff-line--header';

          return (
            <div key={i} className={cls}>
              <span className="diff-ln">{i + 1}</span>
              <span className="diff-text">{line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
