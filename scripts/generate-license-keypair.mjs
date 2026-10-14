// Membuat pasangan kunci RSA untuk menandatangani token lisensi POS.
//   node scripts/generate-license-keypair.mjs
// PRIVATE KEY -> Script Properties `LICENSE_SIGNING_KEY` (jangan pernah di-commit atau dibagikan).
// PUBLIC KEY  -> ditanam di aplikasi kasir untuk memverifikasi token secara offline.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

console.log('=== PRIVATE KEY: tempel ke Script Properties LICENSE_SIGNING_KEY ===\n');
console.log(privateKey);
console.log('=== PUBLIC KEY: simpan untuk aplikasi kasir ===\n');
console.log(publicKey);
