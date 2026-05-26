import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LicensePayload {
  email: string | null;
  plan: 'pro' | 'enterprise';
  seats: number;
  expiresAt: string | null;
}

export interface LicenseInfo {
  valid: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  email: string | null;
  seats: number;
  trial: {
    active: boolean;
    daysRemaining: number;
  };
}

function getLicensePath() {
  return path.join(os.homedir(), '.codesession', 'license.json');
}

function getInstallPath() {
  return path.join(os.homedir(), '.codesession', 'install.json');
}

export function getTrialStatus() {
  const installPath = getInstallPath();
  let installedAt: Date;

  if (fs.existsSync(installPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(installPath, 'utf8'));
      installedAt = new Date(data.installedAt);
    } catch {
      installedAt = new Date();
    }
  } else {
    installedAt = new Date();
    try {
      fs.mkdirSync(path.dirname(installPath), { recursive: true });
      fs.writeFileSync(installPath, JSON.stringify({ installedAt: installedAt.toISOString() }, null, 2));
    } catch {}
  }

  const now = new Date();
  const diffTime = Math.abs(now.getTime() - installedAt.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, 14 - diffDays);

  return {
    active: daysRemaining > 0,
    daysRemaining
  };
}

export function getLicense(): LicenseInfo {
  const trial = getTrialStatus();
  const defaultInfo: LicenseInfo = { valid: false, plan: 'free', email: null, seats: 0, trial };

  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return defaultInfo;

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!data.key || !data.instanceId) return defaultInfo;

    return {
      valid: true,
      plan: data.plan || 'pro',
      email: data.email || null,
      seats: data.seats || 1,
      trial
    };
  } catch {
    return defaultInfo;
  }
}

export async function activateLicense(key: string) {
  try {
    const params = new URLSearchParams();
    params.append('license_key', key);
    params.append('instance_name', os.hostname());

    const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: params
    });

    const result = await response.json() as any;

    if (!response.ok || result.error || !result.activated) {
      return { success: false, error: result.error || 'Invalid license key' };
    }

    const licensePath = getLicensePath();
    fs.mkdirSync(path.dirname(licensePath), { recursive: true });
    
    const email = result.meta?.customer_email || null;
    const plan = 'pro'; // Defaulting to pro since Lemon Squeezy doesn't explicitly return our 'plan' string natively, we only sell pro on LS

    fs.writeFileSync(licensePath, JSON.stringify({
      key,
      instanceId: result.instance.id,
      email,
      plan,
      activatedAt: new Date().toISOString()
    }, null, 2));
    
    return { success: true, license: { email, plan, seats: 1 } };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to activate license online' };
  }
}

export async function deactivateLicense() {
  try {
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath)) return;

    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (data.key && data.instanceId) {
      const params = new URLSearchParams();
      params.append('license_key', data.key);
      params.append('instance_id', data.instanceId);

      await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: params
      });
    }
    fs.unlinkSync(licensePath);
  } catch {}
}

export function isPro(): boolean {
  const license = getLicense();
  return license.valid && (license.plan === 'pro' || license.plan === 'enterprise') || license.trial.active;
}
