export declare const LICENSE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAHPCY4gnBUFQz9PRpWciuKmrZEMeOuIA2DSSoBDxMnbk=\n-----END PUBLIC KEY-----";
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
export declare function validateLicenseKey(key: string): LicensePayload | null;
export declare function getTrialStatus(): {
    active: boolean;
    daysRemaining: number;
};
export declare function getLicense(): LicenseInfo;
export declare function activateLicense(key: string): {
    success: boolean;
    license: LicensePayload;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    license?: undefined;
};
export declare function deactivateLicense(): void;
export declare function isPro(): boolean;
//# sourceMappingURL=license.d.ts.map