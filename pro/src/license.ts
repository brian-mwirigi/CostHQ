import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHPCY4gnBUFQz9PRpWciuKmrZEMeOuIA2DSSoBDxMnbk=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  email: string;
  plan: 'pro' | 'enterprise';
  seats: number;
  issuedAt: string;
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

export function validateLicenseKey(key: string): LicensePayload | null {
  try {
    if (!key.startsWith('CS-PRO-') && !key.startsWith('CS-ENT-')) return null;

    const parts = key.split('-');
    const payloadAndSig = parts.slice(2).join('-');
    const [payloadB64, sigB64] = payloadAndSig.split('.');

    if (!payloadB64 || !sigB64) return null;

    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const signature = Buffer.from(sigB64, 'base64url');

    const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY);
    const isValid = crypto.verify(null, Buffer.from(payloadStr), publicKey, signature);

    if (!isValid) return null;

    return JSON.parse(payloadStr) as LicensePayload;
  } catch {
    return null;
  }
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
  const defaultInfo: LicenseInfo = { valid: false, plan: 'free', email: null, seats: 1, trial };

  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return defaultInfo;

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!data.key) return defaultInfo;

    const payload = validateLicenseKey(data.key);
    if (!payload) return defaultInfo;

    return {
      valid: true,
      plan: payload.plan,
      email: payload.email,
      seats: payload.seats || 1,
      trial
    };
  } catch {
    return defaultInfo;
  }
}

export function activateLicense(key: string) {
  const payload = validateLicenseKey(key);
  if (!payload) return { success: false, error: 'Invalid license key' };

  try {
    const licensePath = getLicensePath();
    fs.mkdirSync(path.dirname(licensePath), { recursive: true });
    fs.writeFileSync(licensePath, JSON.stringify({
      key,
      email: payload.email,
      plan: payload.plan,
      activatedAt: new Date().toISOString()
    }, null, 2));
    
    return { success: true, license: payload };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to save license' };
  }
}

export function deactivateLicense() {
  try {
    const licensePath = getLicensePath();
    if (fs.existsSync(licensePath)) {
      fs.unlinkSync(licensePath);
    }
  } catch {}
}

export function isPro(): boolean {
  const info = getLicense();
  return (info.valid && (info.plan === 'pro' || info.plan === 'enterprise')) || info.trial.active;
}
