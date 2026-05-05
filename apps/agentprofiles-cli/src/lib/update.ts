import { execSync } from 'node:child_process';
import fs from 'node:fs';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'volta' | 'unknown';

interface DetectionResult {
  manager: PackageManager;
  updateCommand: string;
}

function getInstallLocation(binName: string): string | null {
  try {
    const whichResult = execSync(`which ${binName}`, { encoding: 'utf-8' }).trim();
    return fs.realpathSync(whichResult);
  } catch {
    return null;
  }
}

function detectPackageManager(installPath: string | null, pkgName: string): DetectionResult {
  if (!installPath) {
    return { manager: 'unknown', updateCommand: `npm i -g ${pkgName}` };
  }

  const path = installPath.toLowerCase();

  if (path.includes('pnpm/global') || path.includes('.local/share/pnpm')) {
    return { manager: 'pnpm', updateCommand: `pnpm add -g ${pkgName}` };
  }

  if (path.includes('yarn/global') || path.includes('.yarn')) {
    return { manager: 'yarn', updateCommand: `yarn global add ${pkgName}` };
  }

  if (path.includes('.volta/')) {
    return { manager: 'volta', updateCommand: `volta install ${pkgName}` };
  }

  return { manager: 'npm', updateCommand: `npm i -g ${pkgName}` };
}

export async function checkForUpdates(pkg: { name: string; version: string }): Promise<void> {
  const { default: updateNotifier } = await import('update-notifier');

  const installPath = getInstallLocation('agentprofiles');
  const { updateCommand } = detectPackageManager(installPath, pkg.name);

  const notifier = updateNotifier({
    pkg,
    updateCheckInterval: 1000 * 60 * 60 * 24,
  });

  notifier.notify({
    message: `Update available {currentVersion} → {latestVersion}\nRun ${updateCommand} to update`,
    defer: true,
  });
}
