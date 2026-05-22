import * as crypto from 'crypto';

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  console.log('--- PUBLIC KEY (Embed in pro/src/license.ts) ---');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim());
  console.log('\n--- PRIVATE KEY (Keep secret on your server) ---');
  console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim());
}

export function generateLicenseKey(
  privateKeyPem: string,
  email: string,
  plan: 'pro' | 'enterprise',
  seats: number = 1
) {
  const payload = {
    email,
    plan,
    seats,
    issuedAt: new Date().toISOString(),
    expiresAt: null // Lifetime
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payloadStr), privateKey);
  const signatureB64 = signature.toString('base64url');

  const prefix = plan === 'enterprise' ? 'CS-ENT-' : 'CS-PRO-';
  return `${prefix}${payloadB64}.${signatureB64}`;
}

// If run directly, generate a keypair
if (require.main === module) {
  generateKeyPair();
}
