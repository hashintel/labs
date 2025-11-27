import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Save, Check, Eye, EyeOff } from 'lucide-react'

const STORAGE_KEY = 'openrouter-api-key'
const STORAGE_IV_KEY = 'openrouter-api-key-iv'
const ENCRYPTION_SECRET = 'change_this_secret_to_a_long_random_string'

// Utility: get cryptoKey from the (static) ENCRYPTION_SECRET string
async function getCryptoKey() {
  const enc = new TextEncoder();
  const keyData = enc.encode(ENCRYPTION_SECRET);
  return await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Utility: Encrypt the API key
async function encryptData(value: string): Promise<{cipherText: string, iv: string}> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await getCryptoKey();
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    enc.encode(value)
  );
  return {
    cipherText: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

// Utility: Decrypt the API key
async function decryptData(cipherText: string, iv: string): Promise<string> {
  const dec = new TextDecoder();
  const cryptoKey = await getCryptoKey();
  const cipherArray = Uint8Array.from(atob(cipherText), c=>c.charCodeAt(0));
  const ivArray = Uint8Array.from(atob(iv), c=>c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivArray },
    cryptoKey,
    cipherArray
  );
  return dec.decode(decrypted);
}

// Async version for getting stored API key
export async function getStoredApiKey(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const cipherText = localStorage.getItem(STORAGE_KEY);
  const iv = localStorage.getItem(STORAGE_IV_KEY);
  if (cipherText && iv) {
    try {
      return await decryptData(cipherText, iv);
    } catch (_e) {
      // Possibly old/cleartext, cleaning it up
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_IV_KEY);
      return null;
    }
  }
  return null;
}

// Async version for setting stored API key
export async function setStoredApiKey(key: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (key) {
    const { cipherText, iv } = await encryptData(key);
    localStorage.setItem(STORAGE_KEY, cipherText);
    localStorage.setItem(STORAGE_IV_KEY, iv);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_IV_KEY);
  }
}
  const [loading, setLoading] = useState(true)

function ConfigPage() {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let isMounted = true;
    async function loadKey() {
      const stored = await getStoredApiKey();
      if (isMounted && stored) setApiKey(stored);
      setLoading(false);
    }
    loadKey();
    return () => { isMounted = false }
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    await setStoredApiKey(apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleClear = async () => {
    setApiKey('')
    await setStoredApiKey('')
    setSaved(false)
  }

  return (
    <div className="flex min-h-[calc(100vh-80px)] items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-3xl font-bold text-white">Configuration</h1>
        <p className="mb-6 text-gray-400">
          Enter your OpenRouter API key to use the chat features. Your key is
          stored locally in your browser.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label
              htmlFor="apiKey"
              className="mb-2 block text-sm font-medium text-gray-300"
            >
              OpenRouter API Key
            </label>
            <div className="relative">
              <input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-..."
                className="w-full rounded-lg border border-orange-500/20 bg-gray-800/50 px-4 py-3 pr-12 text-white placeholder-gray-500 focus:border-transparent focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showKey ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Get your API key from{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-500 hover:underline"
              >
                openrouter.ai/keys
              </a>
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 px-4 py-3 font-medium text-white transition-opacity hover:opacity-90"
            >
              {saved ? (
                <>
                  <Check className="h-5 w-5" />
                  Saved!
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  Save
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-gray-600 px-4 py-3 text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              Clear
            </button>
          </div>
        </form>

        <div className="mt-6 rounded-lg border border-orange-500/20 bg-gray-800/30 p-4">
          <p className="text-sm text-gray-400">
            <strong className="text-gray-300">Note:</strong> If no key is
            provided, the app will fall back to a server-configured key (if
            available).
          </p>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/demo/config')({
  component: ConfigPage,
})
