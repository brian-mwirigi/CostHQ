import chalk from 'chalk';
import Table from 'cli-table3';
import { Session, SessionStats, FileChange, Commit } from './types';
import { formatDistanceToNow, format } from 'date-fns';

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function displaySession(session: Session): void {
  console.log(chalk.bold.cyan(`\nSession: ${session.name}\n`));

  const table = new Table({
    head: [chalk.cyan.bold('Metric'), chalk.cyan.bold('Value')],
    style: { head: [], border: [] },
  });

  table.push(
    ['Status', session.status === 'active' ? chalk.green('Active') : chalk.gray('Completed')],
    ['Started', format(new Date(session.startTime), 'MMM dd, yyyy HH:mm')],
  );

  if (session.endTime) {
    table.push(['Ended', format(new Date(session.endTime), 'MMM dd, yyyy HH:mm')]);
  }

  if (session.duration) {
    table.push(['Duration', chalk.white(formatDuration(session.duration))]);
  }

  table.push(
    ['Files Changed', chalk.white(session.filesChanged.toString())],
    ['Commits', chalk.white(session.commits.toString())],
    ['AI Tokens', chalk.white(session.aiTokens.toLocaleString())],
    ['AI Cost', chalk.yellow(formatCost(session.aiCost))],
  );

  if (session.notes) {
    table.push(['Notes', chalk.gray(session.notes)]);
  }

  console.log(table.toString());
}

export function displaySessions(sessions: Session[]): void {
  if (sessions.length === 0) {
    console.log(chalk.yellow('\nNo sessions found.\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan.bold('ID'),
      chalk.cyan.bold('Name'),
      chalk.cyan.bold('Started'),
      chalk.cyan.bold('Duration'),
      chalk.cyan.bold('Files'),
      chalk.cyan.bold('Commits'),
      chalk.cyan.bold('AI Cost'),
    ],
    style: { head: [], border: [] },
  });

  for (const session of sessions) {
    table.push([
      chalk.gray(`#${session.id}`),
      session.status === 'active' ? chalk.green(session.name) : chalk.white(session.name),
      formatDistanceToNow(new Date(session.startTime), { addSuffix: true }),
      session.duration ? formatDuration(session.duration) : chalk.gray('ongoing'),
      session.filesChanged.toString(),
      session.commits.toString(),
      chalk.yellow(formatCost(session.aiCost)),
    ]);
  }

  console.log('\n' + table.toString() + '\n');
}

export function displayStats(stats: SessionStats): void {
  console.log(chalk.bold.cyan('\nOverall Stats\n'));

  const table = new Table({
    head: [chalk.cyan.bold('Metric'), chalk.cyan.bold('Value')],
    style: { head: [], border: [] },
  });

  table.push(
    ['Total Sessions', chalk.white(stats.totalSessions.toLocaleString())],
    ['Total Time', chalk.white(formatDuration(stats.totalTime))],
    ['Average Session', chalk.white(formatDuration(stats.avgSessionTime))],
    ['Files Changed', chalk.white(stats.totalFiles.toLocaleString())],
    ['Commits', chalk.white(stats.totalCommits.toLocaleString())],
    ['Total AI Cost', chalk.yellow(formatCost(stats.totalAICost))],
  );

  console.log(table.toString() + '\n');
}

export function displayFileChanges(changes: FileChange[]): void {
  if (changes.length === 0) return;

  console.log(chalk.bold.cyan('\nFile Changes\n'));

  const table = new Table({
    head: [chalk.cyan.bold('Type'), chalk.cyan.bold('File'), chalk.cyan.bold('Time')],
    style: { head: [], border: [] },
  });

  for (const change of changes) {
    const typeColor = change.changeType === 'created' ? chalk.green : 
                      change.changeType === 'modified' ? chalk.yellow : chalk.red;
    
    table.push([
      typeColor(change.changeType),
      change.filePath,
      formatDistanceToNow(new Date(change.timestamp), { addSuffix: true }),
    ]);
  }

  console.log(table.toString() + '\n');
}

export function displayCommits(commits: Commit[]): void {
  if (commits.length === 0) return;

  console.log(chalk.bold.cyan('\nCommits\n'));

  const table = new Table({
    head: [chalk.cyan.bold('Hash'), chalk.cyan.bold('Message'), chalk.cyan.bold('Time')],
    style: { head: [], border: [] },
  });

  for (const commit of commits) {
    table.push([
      chalk.gray(commit.hash),
      commit.message,
      formatDistanceToNow(new Date(commit.timestamp), { addSuffix: true }),
    ]);
  }

  console.log(table.toString() + '\n');
}
