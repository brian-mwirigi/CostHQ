import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchApi } from '../api';
import { useInterval } from '../hooks/useInterval';
import { formatCost, formatDuration, formatDate, formatTokens } from '../utils/format';
import { IconDownload } from './Icons';

interface Session {
  id: number;
  name: string;
  status: 'active' | 'completed';
  startTime: string;
  endTime?: string;
  duration?: number;
  filesChanged: number;
  commits: number;
  aiTokens: number;
  aiCost: number;
}

interface Props {
  onSessionClick: (id: number) => void;
}

type SortKey = 'startTime' | 'name' | 'duration' | 'filesChanged' | 'commits' | 'aiTokens' | 'aiCost';

export default function SessionList({ onSessionClick }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('startTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const limit = 25;

  useEffect(() => {
    const handler = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const fetchSessions = useCallback(() => {
    fetchApi<{ sessions: Session[]; total: number }>('/api/sessions', {
      limit: String(limit),
      offset: String(page * limit),
      status,
      search,
    }).then((data) => {
      setSessions(data.sessions);
      setTotal(data.total);
    }).catch(console.error);
  }, [status, search, page]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useInterval(fetchSessions, 30_000);

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = typeof aVal === 'number' ? aVal - (bVal as number) : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [sessions, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const totalPages = Math.ceil(total / limit);
  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'desc' ? ' \u2193' : ' \u2191') : '';

  const getAriaSort = (key: SortKey) => 
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const costPerHour = (s: Session) => {
    if (!s.duration || s.duration === 0 || !s.aiCost) return null;
    return s.aiCost / (s.duration / 3600);
  };

  const handleExport = (format: 'json' | 'csv') => {
    const token = (window as any).__CS_TOKEN
      || new URLSearchParams(window.location.search).get('token')
      || '';
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    window.open(`/api/v1/export?format=${format}${tokenParam}`, '_blank');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Sessions</h1>
        <div className="page-subtitle">All recorded coding sessions</div>
      </div>

      <div className="filters">
        <input
          type="text"
          className="filter-input"
          placeholder="Search by name\u2026"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          className="filter-select"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }}
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="active">Active</option>
        </select>
        <span className="filter-meta">{total} session{total !== 1 ? 's' : ''}</span>
        <button className="export-btn" onClick={() => handleExport('json')} title="Export as JSON">
          <IconDownload size={14} /> JSON
        </button>
        <button className="export-btn" onClick={() => handleExport('csv')} title="Export as CSV">
          <IconDownload size={14} /> CSV
        </button>
      </div>

      <div className="card">
        <div className="card-body--flush">
          <div className="table-wrap">
            <table className="tbl tbl--clickable">
              <thead>
                <tr>
                  <th role="columnheader" aria-sort={getAriaSort('name')} className="sortable" onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                  <th role="columnheader">Status</th>
                  <th role="columnheader" aria-sort={getAriaSort('startTime')} className="sortable r" onClick={() => toggleSort('startTime')}>Started{arrow('startTime')}</th>
                  <th role="columnheader" aria-sort={getAriaSort('duration')} className="sortable r" onClick={() => toggleSort('duration')}>Duration{arrow('duration')}</th>
                  <th role="columnheader" aria-sort={getAriaSort('filesChanged')} className="sortable r" onClick={() => toggleSort('filesChanged')}>Files{arrow('filesChanged')}</th>
                  <th role="columnheader" aria-sort={getAriaSort('commits')} className="sortable r" onClick={() => toggleSort('commits')}>Commits{arrow('commits')}</th>
                  <th role="columnheader" aria-sort={getAriaSort('aiTokens')} className="sortable r" onClick={() => toggleSort('aiTokens')}>Tokens{arrow('aiTokens')}</th>
                  <th role="columnheader" aria-sort={getAriaSort('aiCost')} className="sortable r" onClick={() => toggleSort('aiCost')}>Cost{arrow('aiCost')}</th>
                  <th role="columnheader" className="r">$/hr</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={9} className="empty">No sessions found</td></tr>
                ) : sorted.map((s) => (
                  <tr key={s.id} onClick={() => onSessionClick(s.id)}>
                    <td className="ellipsis" title={s.name}>{s.name}</td>
                    <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                    <td className="r mono">{formatDate(s.startTime)}</td>
                    <td className="r mono">{formatDuration(s.duration)}</td>
                    <td className="r mono">{s.filesChanged}</td>
                    <td className="r mono">{s.commits}</td>
                    <td className="r mono">{formatTokens(s.aiTokens)}</td>
                    <td className="r mono cost">{formatCost(s.aiCost)}</td>
                    <td className="r mono">{costPerHour(s) !== null ? formatCost(costPerHour(s)!) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className="page-info">{page + 1} / {totalPages}</span>
          <button aria-label="Next page" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
