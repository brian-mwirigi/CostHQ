import { isPro, getLicense } from './license';
import chalk from 'chalk';

export const UPGRADE_URL = 'https://codesession.dev/pro'; // Update this to your Lemon Squeezy storefront or landing page

export function requirePro(featureName: string): boolean {
  if (isPro()) return true;

  console.log(chalk.yellow(`\n[PRO] ${featureName} is a Pro feature.`));
  console.log(chalk.gray(`Upgrade at ${UPGRADE_URL} to unlock advanced analytics and integrations.\n`));
  
  return false;
}

export function getGatedFeatures() {
  const license = getLicense();
  const pro = license.valid && (license.plan === 'pro' || license.plan === 'enterprise') || license.trial.active;
  const ent = license.valid && license.plan === 'enterprise';

  return {
    insights: pro,
    alerts: pro,
    shareStats: pro,
    csvExport: pro,
    autoLog: pro,
    customPricing: pro,
    teamManagement: ent
  };
}
