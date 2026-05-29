import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

type Plan = 'free' | 'pro' | 'enterprise';

export interface LicensePayload {
  email: string | null;
  plan: 'pro' | 'enterprise';
  seats: number;
  expiresAt: string | null;
}

export interface LicenseInfo {
  valid: boolean;
  plan: Plan;
  email: string | null;
  seats: number;
  status?: string;
  lastValidatedAt?: string;
  nextValidationAt?: string;
  validationRequired?: boolean;
  reason?: string;
  trial: {
    active: boolean;
    daysRemaining: number;
  };
}

interface StoredLicense {
  version: 2;
  key: string;
  instanceId: string;
  email: string | null;
  plan: 'pro' | 'enterprise';
  seats: number;
  status: string;
  activatedAt: string;
  lastValidatedAt: string;
  nextValidationAt: string;
  seal: string;
}

const LEMON_API = 'https://api.lemonsqueezy.com/v1/licenses';
const VALIDATION_TTL_DAYS = 14;

function getLicensePath() {
  return path.join(os.homedir(), '.codesession', 'license.json');
}

function getInstallPath() {
  return path.join(os.homedir(), '.codesession', 'install.json');
}

function getMachineId() {
  return `${os.hostname()}|${os.platform()}|${os.arch()}|${os.homedir()}`;
}

function sealPayload(data: Omit<StoredLicense, 'seal'>): string {
  return crypto
    .createHmac('sha256', `codesession-license-v2|${getMachineId()}`)
    .update(JSON.stringify(data))
    .digest('hex');
}

function verifyStoredLicense(data: any): data is StoredLicense {
  if (!data || data.version !== 2 || typeof data.key !== 'string' || typeof data.instanceId !== 'string') return false;
  if (typeof data.seal !== 'string') return false;
  const { seal, ...payload } = data;
  try {
    return crypto.timingSafeEqual(Buffer.from(seal), Buffer.from(sealPayload(payload)));
  } catch {
    return false;
  }
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeStatus(result: any): string {
  return String(result?.license_key?.status || result?.status || '').toLowerCase();
}

function planFromResult(result: any): 'pro' | 'enterprise' {
  const variant = String(result?.meta?.variant_name || result?.license_key?.variant_name || '').toLowerCase();
  return variant.includes('enterprise') ? 'enterprise' : 'pro';
}

function emailFromResult(result: any): string | null {
  return result?.meta?.customer_email || result?.license_key?.customer_email || null;
}

function seatsFromResult(result: any): number {
  const limit = Number(result?.license_key?.activation_limit || result?.license_key?.activationLimit);
  return Number.isFinite(limit) && limit > 0 ? limit : 1;
}

function inactiveReason(status: string): string {
  if (!status) return 'License validation failed';
  return `License status is ${status}`;
}

function saveStoredLicense(license: Omit<StoredLicense, 'seal'>): StoredLicense {
  const sealed: StoredLicense = { ...license, seal: sealPayload(license) };
  const licensePath = getLicensePath();
  fs.mkdirSync(path.dirname(licensePath), { recursive: true });
  fs.writeFileSync(licensePath, JSON.stringify(sealed, null, 2));
  return sealed;
}

async function postLemon(pathname: 'activate' | 'validate' | 'deactivate', params: URLSearchParams): Promise<any> {
  const response = await fetch(`${LEMON_API}/${pathname}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: params,
  });
  const result = await response.json().catch(() => ({})) as any;
  if (!response.ok || result.error) {
    throw new Error(result.error || `Lemon Squeezy ${pathname} failed`);
  }
  return result;
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
  const diffDays = Math.max(0, Math.ceil((now.getTime() - installedAt.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, 14 - diffDays);

  return {
    active: daysRemaining > 0,
    daysRemaining,
  };
}

export function getLicense(): LicenseInfo {
  const trial = getTrialStatus();
  const defaultInfo: LicenseInfo = { valid: false, plan: 'free', email: null, seats: 0, trial };
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return defaultInfo;

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!verifyStoredLicense(data)) {
      return { ...defaultInfo, reason: 'Local license file failed integrity check' };
    }

    const now = Date.now();
    const nextValidation = new Date(data.nextValidationAt).getTime();
    if (!Number.isFinite(nextValidation) || now > nextValidation) {
      return {
        ...defaultInfo,
        email: data.email,
        status: data.status,
        lastValidatedAt: data.lastValidatedAt,
        nextValidationAt: data.nextValidationAt,
        validationRequired: true,
        reason: 'Online license refresh required',
      };
    }

    if (data.status !== 'active') {
      return {
        ...defaultInfo,
        email: data.email,
        status: data.status,
        lastValidatedAt: data.lastValidatedAt,
        nextValidationAt: data.nextValidationAt,
        reason: inactiveReason(data.status),
      };
    }

    return {
      valid: true,
      plan: data.plan,
      email: data.email,
      seats: data.seats,
      status: data.status,
      lastValidatedAt: data.lastValidatedAt,
      nextValidationAt: data.nextValidationAt,
      trial,
    };
  } catch {
    return { ...defaultInfo, reason: 'Failed to read local license file' };
  }
}

export async function activateLicense(key: string) {
  try {
    if (!key || !key.trim()) return { success: false, error: 'License key is required' };

    const params = new URLSearchParams();
    params.append('license_key', key.trim());
    params.append('instance_name', `${os.hostname()} (${os.platform()} ${os.arch()})`);

    const result = await postLemon('activate', params);
    if (!result.activated || !result.instance?.id) {
      return { success: false, error: result.error || 'Invalid license key' };
    }

    const status = normalizeStatus(result) || 'active';
    if (status !== 'active') {
      return { success: false, error: inactiveReason(status) };
    }

    const now = new Date();
    const stored = saveStoredLicense({
      version: 2,
      key: key.trim(),
      instanceId: String(result.instance.id),
      email: emailFromResult(result),
      plan: planFromResult(result),
      seats: seatsFromResult(result),
      status,
      activatedAt: now.toISOString(),
      lastValidatedAt: now.toISOString(),
      nextValidationAt: addDays(now, VALIDATION_TTL_DAYS),
    });

    return { success: true, license: getPublicLicense(stored) };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to activate license online' };
  }
}

export async function refreshLicense() {
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return { success: false, error: 'No local license to refresh' };

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!verifyStoredLicense(data)) {
      return { success: false, error: 'Local license file failed integrity check' };
    }

    const params = new URLSearchParams();
    params.append('license_key', data.key);
    params.append('instance_id', data.instanceId);

    const result = await postLemon('validate', params);
    if (!result.valid) {
      return { success: false, error: result.error || 'License is no longer valid' };
    }

    const status = normalizeStatus(result) || 'active';
    const now = new Date();
    const stored = saveStoredLicense({
      version: 2,
      key: data.key,
      instanceId: data.instanceId,
      email: emailFromResult(result) || data.email,
      plan: planFromResult(result),
      seats: seatsFromResult(result),
      status,
      activatedAt: data.activatedAt,
      lastValidatedAt: now.toISOString(),
      nextValidationAt: addDays(now, VALIDATION_TTL_DAYS),
    });

    if (status !== 'active') return { success: false, error: inactiveReason(status), license: getPublicLicense(stored) };
    return { success: true, license: getPublicLicense(stored) };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to refresh license online' };
  }
}

function getPublicLicense(data: StoredLicense): LicensePayload {
  return {
    email: data.email,
    plan: data.plan,
    seats: data.seats,
    expiresAt: null,
  };
}

export async function deactivateLicense() {
  try {
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath)) return;

    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (verifyStoredLicense(data)) {
      const params = new URLSearchParams();
      params.append('license_key', data.key);
      params.append('instance_id', data.instanceId);
      await postLemon('deactivate', params).catch(() => {});
    }
    fs.unlinkSync(licensePath);
  } catch {}
}

export function isPro(): boolean {
  const license = getLicense();
  return license.valid && (license.plan === 'pro' || license.plan === 'enterprise');
}
