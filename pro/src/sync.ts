import { createClient } from '@supabase/supabase-js';
import chalk from 'chalk';
import { getSessions, getFileChanges, getCommits, getAIUsage, getNotes } from '../../src/db';
import { setConfig, getConfig } from '../../src/db';

const SUPABASE_URL = 'https://igmpvdvygkgjilakgslz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbXB2ZHZ5Z2tnamlsYWtnc2x6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjI1ODAsImV4cCI6MjA5NTAzODU4MH0.iQMMxcRLsh1wJppUZSirsP0TKdDyzWD4aafXPJvFPFg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // We'll manage session state in our config
  }
});

export async function loginToCloud(email: string) {
  // In a real CLI flow we would prompt for password or send a magic link.
  // For simplicity, we'll send an OTP magic link to their email.
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
  });

  if (error) {
    console.error(chalk.red(`\n[ERROR] Login failed: ${error.message}`));
    return;
  }

  console.log(chalk.green(`\n✅ Magic login link sent to ${email}!`));
  console.log(chalk.gray(`Please check your email and run 'cs verify <token>' to complete login.`));
  setConfig('cloud_email', email);
}

export async function verifyCloudToken(token: string) {
  const email = getConfig('cloud_email');
  if (!email) {
    console.error(chalk.red(`\n[ERROR] No login session found. Run 'cs login <email>' first.`));
    return;
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'magiclink'
  });

  if (error || !data.session) {
    console.error(chalk.red(`\n[ERROR] Verification failed: ${error?.message || 'Invalid token'}`));
    return;
  }

  setConfig('cloud_access_token', data.session.access_token);
  setConfig('cloud_refresh_token', data.session.refresh_token);
  setConfig('cloud_user_id', data.user?.id || '');
  console.log(chalk.green(`\n✅ Successfully authenticated as ${email}!`));
}

async function getAuthenticatedClient() {
  const accessToken = getConfig('cloud_access_token');
  const refreshToken = getConfig('cloud_refresh_token');
  if (!accessToken) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || '',
  });

  if (error) {
    return null;
  }

  // Update tokens if refreshed
  if (data.session) {
    setConfig('cloud_access_token', data.session.access_token);
    setConfig('cloud_refresh_token', data.session.refresh_token);
  }

  return supabase;
}

export async function syncSessionsToCloud() {
  const client = await getAuthenticatedClient();
  if (!client) {
    console.log(chalk.red(`\n[ERROR] You must be logged in to sync. Run 'cs login <email>' first.`));
    return;
  }

  const userId = getConfig('cloud_user_id');
  console.log(chalk.blue(`\n🔄 Syncing local sessions to Supabase Cloud...`));

  const sessions = getSessions(99999);
  let synced = 0;

  for (const session of sessions) {
    // Upsert Session
    const { error: sessionError } = await client.from('sessions').upsert({
      id: session.id,
      user_id: userId,
      name: session.name,
      start_time: session.startTime,
      end_time: session.endTime,
      duration: session.duration,
      working_directory: session.workingDirectory,
      files_changed: session.filesChanged,
      commits: session.commits,
      ai_cost: session.aiCost,
      ai_tokens: session.aiTokens,
      status: session.status
    });

    if (sessionError) {
      console.log(chalk.red(`  Failed to sync session ${session.id}: ${sessionError.message}`));
      continue;
    }

    // Optional: Sync AI Usage
    const usage = getAIUsage(session.id!);
    if (usage.length > 0) {
      const usagePayload = usage.map(u => ({
        id: u.id,
        session_id: u.sessionId,
        user_id: userId,
        provider: u.provider,
        model: u.model,
        tokens: u.tokens,
        cost: u.cost,
        timestamp: u.timestamp
      }));
      await client.from('ai_usage').upsert(usagePayload);
    }

    synced++;
  }

  console.log(chalk.green(`\n✅ Synced ${synced} sessions to the cloud!`));
}
