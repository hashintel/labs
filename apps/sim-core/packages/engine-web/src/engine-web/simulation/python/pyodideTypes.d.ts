export type MessageCallback = (msg: any) => void;
export type ErrorCallback = (errMsg: any) => void;

// (incomplete) type stub for a Pyodide PyProxy.
export interface PyProxy {
  set(name: string, value: any): void;
  get(name: string): any;
  has(name: string): boolean;
}

// We add a generic parameter to extend pyodide with a custom globals map
export interface Pyodide {
  _module: PyodideModule;

  /**
   * The loaded Package Map
   */
  loadedPackages: { [key: string]: string };

  loadPackage(
    names: string | string[],
    messageCallback?: MessageCallback,
    errorCallback?: ErrorCallback
  ): Promise<void>;

  loadPackagesFromImports(
    code: string,
    messageCallback?: MessageCallback,
    errorCallback?: ErrorCallback
  ): Promise<void>;

  loadedPackages: object;
  isPyProxy(jsobj: any): boolean;
  runPython(code: string, globals?: PyProxy): void;

  runPythonAsync(
    script: string,
    messageCallback?: MessageCallback,
    errorCallback?: ErrorCallback
  ): Promise<any>;

  registerJsModule(name: string, module: object): void;
  unregisterJsModule(name: string): void;
  toPy(obj: any, depth?: number): PyProxy;
  version(): string;
  pyimport: (name: string) => any;
  globals: PyProxy;
  pyodide_py: any;
}

export interface PyodideModule {
  FS: any;
  noImageDecoding: boolean;
  noAudioDecoding: boolean;
  noWasmDecoding: boolean;
  preloadedWasm: any;
  packages: {
    dependencies: { [key: string]: string[] };
    import_name_to_package_name: { [key: string]: string };
  };
  locateFile: (path: string) => string;
  instantiateWasm(info: any, receiveInstance: (instance: any) => void): any;
  postRun(): void;
  monitorRunDependencies(n: number): void;
  loadWebAssemblyModule(file: any, flag: boolean): Promise<any>;
}
