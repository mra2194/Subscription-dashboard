import { useState } from 'react';

/** Menampilkan license key satu kali. Setelah ditutup, key tidak bisa dilihat lagi. */
export function LicenseKeyDialog({ licenseKey, customerCode, onClose }: { licenseKey: string; customerCode: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`Customer ID: ${customerCode}\nLicense key: ${licenseKey}`);
    setCopied(true);
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card narrow">
        <h2>License key baru</h2>
        <div className="alert info">Simpan sekarang. Key ini hanya ditampilkan sekali dan tidak bisa dilihat lagi.</div>
        <dl className="kv">
          <dt>Customer ID</dt><dd><code>{customerCode}</code></dd>
          <dt>License key</dt><dd><code className="key">{licenseKey}</code></dd>
        </dl>
        <button onClick={copy}>{copied ? 'Tersalin ✓' : 'Salin keduanya'}</button>
        <button className="ghost" onClick={onClose}>Sudah saya simpan</button>
      </div>
    </div>
  );
}
