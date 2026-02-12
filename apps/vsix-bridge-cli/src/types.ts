export interface IDEConfig {
  id: string;
  name: string;
  cli: string;
  appPath: string;
  engineVersionKey: string;
  dataFolderName: string;
}

export interface DetectedIDE extends IDEConfig {
  engineVersion: string;
  cliAvailable: boolean;
}

export interface Extension {
  id: string;
  version: string;
  disabled: boolean;
}

export interface SyncedVSIX {
  extensionId: string;
  version: string;
  path: string;
  sourceDisabled: boolean;
}

export interface InstallAction {
  type: 'install' | 'update' | 'uninstall' | 'disable' | 'enable';
  extensionId: string;
  version?: string;
  vsixPath?: string;
  currentVersion?: string;
}

export interface InstallPlan {
  ide: DetectedIDE;
  actions: InstallAction[];
}

export interface MarketplaceVersion {
  version: string;
  engineSpec: string;
  vsixUrl: string | null;
}

export interface MarketplaceExtension {
  id: string;
  publisher: string;
  name: string;
  versions: MarketplaceVersion[];
}
