import { describe, it, expect } from 'vitest';
import { generateInstallPlan, describeAction } from './install-plan.js';
import type { Extension, SyncedVSIX } from '../types.js';

describe('install-plan', () => {
  const defaultOptions = {
    syncRemovals: false,
  };

  describe('generateInstallPlan', () => {
    it('returns empty plan when no actions needed', () => {
      const installed: Extension[] = [{ id: 'test.ext', version: '1.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [
        { extensionId: 'test.ext', version: '1.0.0', path: '/path', sourceDisabled: false },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);
      expect(plan).toHaveLength(0);
    });

    it('installs missing extensions', () => {
      const installed: Extension[] = [];
      const synced: SyncedVSIX[] = [
        { extensionId: 'new.ext', version: '1.0.0', path: '/path', sourceDisabled: false },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);

      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        type: 'install',
        extensionId: 'new.ext',
        version: '1.0.0',
      });
    });

    it('installs and disables new extension when source is disabled', () => {
      const installed: Extension[] = [];
      const synced: SyncedVSIX[] = [
        { extensionId: 'new.ext', version: '1.0.0', path: '/path', sourceDisabled: true },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);

      expect(plan).toHaveLength(2);
      expect(plan[0]?.type).toBe('install');
      expect(plan[1]?.type).toBe('disable');
    });

    it('updates outdated extensions', () => {
      const installed: Extension[] = [{ id: 'test.ext', version: '1.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [
        { extensionId: 'test.ext', version: '2.0.0', path: '/path', sourceDisabled: false },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        type: 'update',
        extensionId: 'test.ext',
        version: '2.0.0',
        currentVersion: '1.0.0',
      });
    });

    it('does not downgrade newer extensions', () => {
      const installed: Extension[] = [{ id: 'test.ext', version: '2.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [
        { extensionId: 'test.ext', version: '1.0.0', path: '/path', sourceDisabled: false },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);
      expect(plan).toHaveLength(0);
    });

    it('preserves target disabled state on update (does not re-enable)', () => {
      const installed: Extension[] = [{ id: 'test.ext', version: '1.0.0', disabled: true }];
      const synced: SyncedVSIX[] = [
        { extensionId: 'test.ext', version: '2.0.0', path: '/path', sourceDisabled: false },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe('update');
      // No enable action - target's disabled state is preserved
    });

    it('preserves target enabled state on update (does not disable)', () => {
      const installed: Extension[] = [{ id: 'test.ext', version: '1.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [
        { extensionId: 'test.ext', version: '2.0.0', path: '/path', sourceDisabled: true },
      ];

      const plan = generateInstallPlan(installed, synced, defaultOptions);

      expect(plan).toHaveLength(1);
      expect(plan[0]?.type).toBe('update');
      // No disable action - target's enabled state is preserved
    });

    it('skips removals by default', () => {
      const installed: Extension[] = [{ id: 'orphan.ext', version: '1.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [];

      const plan = generateInstallPlan(installed, synced, defaultOptions);
      expect(plan).toHaveLength(0);
    });

    it('uninstalls orphaned extensions with --sync-removals', () => {
      const installed: Extension[] = [{ id: 'orphan.ext', version: '1.0.0', disabled: false }];
      const synced: SyncedVSIX[] = [];

      const plan = generateInstallPlan(installed, synced, {
        syncRemovals: true,
      });

      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        type: 'uninstall',
        extensionId: 'orphan.ext',
      });
    });
  });

  describe('describeAction', () => {
    it('describes install action', () => {
      const desc = describeAction({
        type: 'install',
        extensionId: 'test.ext',
        version: '1.0.0',
        vsixPath: '/path',
      });
      expect(desc).toBe('Install test.ext@1.0.0');
    });

    it('describes update action', () => {
      const desc = describeAction({
        type: 'update',
        extensionId: 'test.ext',
        version: '2.0.0',
        currentVersion: '1.0.0',
        vsixPath: '/path',
      });
      expect(desc).toBe('Update test.ext: 1.0.0 → 2.0.0');
    });

    it('describes uninstall action', () => {
      const desc = describeAction({
        type: 'uninstall',
        extensionId: 'test.ext',
      });
      expect(desc).toBe('Uninstall test.ext');
    });

    it('describes disable action', () => {
      const desc = describeAction({
        type: 'disable',
        extensionId: 'test.ext',
      });
      expect(desc).toBe('Disable test.ext');
    });

    it('describes enable action', () => {
      const desc = describeAction({
        type: 'enable',
        extensionId: 'test.ext',
      });
      expect(desc).toBe('Enable test.ext');
    });
  });
});
