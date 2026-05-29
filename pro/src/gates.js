"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPGRADE_URL = void 0;
exports.requirePro = requirePro;
exports.getGatedFeatures = getGatedFeatures;
const license_1 = require("./license");
const chalk_1 = __importDefault(require("chalk"));
exports.UPGRADE_URL = 'https://codesession-cli.lemonsqueezy.com';
function requirePro(featureName) {
    if ((0, license_1.isPro)())
        return true;
    console.log(chalk_1.default.yellow(`\n[PRO] ${featureName} is a Pro feature.`));
    console.log(chalk_1.default.gray(`Upgrade at ${exports.UPGRADE_URL} to unlock advanced analytics and integrations.\n`));
    return false;
}
function getGatedFeatures() {
    const license = (0, license_1.getLicense)();
    const pro = license.valid && (license.plan === 'pro' || license.plan === 'enterprise');
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
//# sourceMappingURL=gates.js.map