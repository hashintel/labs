import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { requestDeviceCode, pollForToken } = await import('../../src/lib/github-auth.js');

describe('github-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestDeviceCode', () => {
    it('requests device code successfully', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await requestDeviceCode('test-client-id');

      expect(result.device_code).toBe('test-device-code');
      expect(result.user_code).toBe('TEST-CODE');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/login/device/code',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );
    });

    it('throws on failed device code request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized',
      });

      await expect(requestDeviceCode('test-client-id')).rejects.toThrow(
        'Failed to request device code'
      );
    });
  });

  describe('pollForToken', () => {
    it('returns token on successful authorization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token-123',
        }),
      });

      const token = await pollForToken('test-client-id', 'test-device-code', 1, 10);

      expect(token).toBe('test-token-123');
    });

    it('retries on authorization_pending', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            error: 'authorization_pending',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'test-token-123',
          }),
        });

      const token = await pollForToken('test-client-id', 'test-device-code', 1, 10);

      expect(token).toBe('test-token-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on access_denied', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'access_denied',
        }),
      });

      await expect(pollForToken('test-client-id', 'test-device-code', 1, 10)).rejects.toThrow(
        'Authorization denied by user'
      );
    });

    it('throws on expired_token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'expired_token',
        }),
      });

      await expect(pollForToken('test-client-id', 'test-device-code', 1, 10)).rejects.toThrow(
        'Device code expired'
      );
    });

    it('throws on timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'authorization_pending',
        }),
      });

      await expect(pollForToken('test-client-id', 'test-device-code', 1, 2)).rejects.toThrow(
        'Device code polling timeout'
      );
    });
  });
});
