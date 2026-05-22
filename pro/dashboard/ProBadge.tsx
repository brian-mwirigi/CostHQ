import { useLicense } from './LicenseContext';

export default function ProBadge() {
  const { isPro } = useLicense();
  
  if (isPro) return null;
  
  return (
    <span className="pro-badge">PRO</span>
  );
}
