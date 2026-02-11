import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { DeviceCodeResponse } from '../types/index.js';

export const GITHUB_CLIENT_ID = process.env.CLONES_GITHUB_CLIENT_ID || 'Ov23liXXXXXXXXXXXXXX';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

/**
 * Request a device code from GitHub
 */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'repo',
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.statusText}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Poll for token until user authorizes or timeout
 */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  maxAttempts: number = 120
): Promise<string> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;

    // Wait before polling
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to poll for token: ${response.statusText}`);
    }

    const data = (await response.json()) as TokenResponse;

    if (data.error) {
      if (data.error === 'authorization_pending') {
        // User hasn't authorized yet, continue polling
        continue;
      }
      if (data.error === 'slow_down') {
        // GitHub asked us to slow down, increase interval
        interval += 5;
        continue;
      }
      if (data.error === 'expired_token') {
        throw new Error('Device code expired. Please try again.');
      }
      if (data.error === 'access_denied') {
        throw new Error('Authorization denied by user.');
      }
      throw new Error(`OAuth error: ${data.error_description || data.error}`);
    }

    if (data.access_token) {
      return data.access_token;
    }
  }

  throw new Error('Device code polling timeout. Please try again.');
}

/**
 * Open browser to GitHub device auth page
 */
export async function openBrowserToAuth(verificationUri: string): Promise<void> {
  // Try to open with 'open' command (macOS/Linux)
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${verificationUri}"`);
  } catch {
    // Fallback: just print the URL
    p.log.info(`Please open this URL in your browser: ${verificationUri}`);
  }
}

/**
 * Perform the full GitHub Device Flow authentication
 */
export async function performDeviceFlowAuth(clientId: string): Promise<string> {
  const s = p.spinner();

  s.start('Requesting device code from GitHub...');
  const deviceCodeResponse = await requestDeviceCode(clientId);
  s.stop('Device code received');

  p.log.info(`\nGitHub Device Flow Authentication`);
  p.log.info(`User code: ${pc.cyan(deviceCodeResponse.user_code)}`);
  p.log.info(`Verification URL: ${deviceCodeResponse.verification_uri}`);
  p.log.info(`\nOpening browser...`);

  await openBrowserToAuth(deviceCodeResponse.verification_uri);

  p.log.info(`\nWaiting for authorization (expires in ${deviceCodeResponse.expires_in}s)...`);

  s.start('Polling for authorization...');
  const token = await pollForToken(
    clientId,
    deviceCodeResponse.device_code,
    deviceCodeResponse.interval
  );
  s.stop('Authorization successful!');

  return token;
}
