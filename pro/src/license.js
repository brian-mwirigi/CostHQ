"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LICENSE_PUBLIC_KEY = void 0;
exports.validateLicenseKey = validateLicenseKey;
exports.getTrialStatus = getTrialStatus;
exports.getLicense = getLicense;
exports.activateLicense = activateLicense;
exports.deactivateLicense = deactivateLicense;
exports.isPro = isPro;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHPCY4gnBUFQz9PRpWciuKmrZEMeOuIA2DSSoBDxMnbk=
-----END PUBLIC KEY-----`;
function validateLicenseKey(key) {
    try {
        if (!key.startsWith('CS-PRO-') && !key.startsWith('CS-ENT-'))
            return null;
        const parts = key.split('-');
        const payloadAndSig = parts.slice(2).join('-');
        const [payloadB64, sigB64] = payloadAndSig.split('.');
        if (!payloadB64 || !sigB64)
            return null;
        const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const signature = Buffer.from(sigB64, 'base64url');
        const publicKey = crypto.createPublicKey(exports.LICENSE_PUBLIC_KEY);
        const isValid = crypto.verify(null, Buffer.from(payloadStr), publicKey, signature);
        if (!isValid)
            return null;
        return JSON.parse(payloadStr);
    }
    catch {
        return null;
    }
}
function getLicensePath() {
    return path.join(os.homedir(), '.codesession', 'license.json');
}
function getInstallPath() {
    return path.join(os.homedir(), '.codesession', 'install.json');
}
function getTrialStatus() {
    const installPath = getInstallPath();
    let installedAt;
    if (fs.existsSync(installPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(installPath, 'utf8'));
            installedAt = new Date(data.installedAt);
        }
        catch {
            installedAt = new Date();
        }
    }
    else {
        installedAt = new Date();
        try {
            fs.mkdirSync(path.dirname(installPath), { recursive: true });
            fs.writeFileSync(installPath, JSON.stringify({ installedAt: installedAt.toISOString() }, null, 2));
        }
        catch { }
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
function getLicense() {
    const trial = getTrialStatus();
    const defaultInfo = { valid: false, plan: 'free', email: null, seats: 1, trial };
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath))
        return defaultInfo;
    try {
        const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
        if (!data.key)
            return defaultInfo;
        const payload = validateLicenseKey(data.key);
        if (!payload)
            return defaultInfo;
        return {
            valid: true,
            plan: payload.plan,
            email: payload.email,
            seats: payload.seats || 1,
            trial
        };
    }
    catch {
        return defaultInfo;
    }
}
function activateLicense(key) {
    const payload = validateLicenseKey(key);
    if (!payload)
        return { success: false, error: 'Invalid license key' };
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
    }
    catch (err) {
        return { success: false, error: err.message || 'Failed to save license' };
    }
}
function deactivateLicense() {
    try {
        const licensePath = getLicensePath();
        if (fs.existsSync(licensePath)) {
            fs.unlinkSync(licensePath);
        }
    }
    catch { }
}
function isPro() {
    const info = getLicense();
    return (info.valid && (info.plan === 'pro' || info.plan === 'enterprise')) || info.trial.active;
}
//# sourceMappingURL=license.js.map