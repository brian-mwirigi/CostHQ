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
export declare function getTrialStatus(): {
    active: boolean;
    daysRemaining: number;
};
export declare function getLicense(): LicenseInfo;
export declare function activateLicense(key: string): Promise<{
    success: boolean;
    error: any;
    license?: undefined;
} | {
    success: boolean;
    license: LicensePayload;
    error?: undefined;
}>;
export declare function refreshLicense(): Promise<{
    success: boolean;
    error: any;
    license?: undefined;
} | {
    success: boolean;
    error: string;
    license: LicensePayload;
} | {
    success: boolean;
    license: LicensePayload;
    error?: undefined;
}>;
export declare function deactivateLicense(): Promise<void>;
export declare function isPro(): boolean;
export {};
//# sourceMappingURL=license.d.ts.map