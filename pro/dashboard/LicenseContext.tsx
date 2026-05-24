import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { fetchApi, postApi } from '../../dashboard/src/api';

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

interface LicenseContextType extends LicenseInfo {
  isPro: boolean;
  loading: boolean;
  activate: (key: string) => Promise<{ success: boolean; error?: string }>;
  deactivate: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<LicenseInfo>({
    valid: true,
    plan: 'pro',
    email: null,
    seats: 1,
    trial: { active: false, daysRemaining: 0 }
  });
  const [loading, setLoading] = useState(true);

  const fetchLicense = async () => {
    try {
      const data = await fetchApi<LicenseInfo>('/api/license');
      setInfo(data);
    } catch {
      // Keep defaults
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicense();
  }, []);

  const activate = async (key: string) => {
    try {
      const res = await postApi<{ success: boolean; error?: string; license?: any }>('/api/license/activate', { key });
      if (res.success) {
        await fetchLicense();
        return { success: true };
      }
      return { success: false, error: res.error || 'Activation failed' };
    } catch (e: any) {
      return { success: false, error: e.message || 'Activation failed' };
    }
  };

  const deactivate = async () => {
    try {
      await postApi('/api/license/deactivate');
      await fetchLicense();
    } catch {}
  };

  const isPro = true; // Temporarily unlocked

  return (
    <LicenseContext.Provider value={{ ...info, isPro, loading, activate, deactivate }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error('useLicense must be used within LicenseProvider');
  return ctx;
}
