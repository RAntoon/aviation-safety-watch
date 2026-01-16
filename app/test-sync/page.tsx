'use client';

import { useState } from 'react';

export default function TestSync() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runSync = async () => {
    setLoading(true);
    try {
      // Call our wrapper API that has the secret
      const response = await fetch('/api/trigger-sync');
      const data = await response.json();
      setResult(data);
    } catch (error: any) {
      setResult({ error: error.message });
    }
    setLoading(false);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">NTSB Sync Test</h1>
      
      <button
        onClick={runSync}
        disabled={loading}
        className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? 'Syncing...' : 'Run Sync Now'}
      </button>

      {result && (
        <pre className="mt-4 p-4 bg-gray-100 rounded-lg overflow-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}