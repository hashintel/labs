import {
  ErrorCallback,
  MessageCallback,
  PyProxy,
  Pyodide,
} from "./python/pyodideTypes";
import {
  PyContextWrapper,
  PyStateWrapper,
  getPyodideLoader,
  pyodideInitialize,
} from "./python";
import { loadPystdlib, pyodideWrapperInit } from "./python/index";
import { pystdlibsrc } from "../../stdlib/py/pystdlib";

// *** ATTENTION ***
// Pyodide 0.17.0 ships with a version of the decorator package (5.0.5) which is
// incompatible with NetworkX. This build (pyodide-0.17.0-patch) is a patched version of
// Pyodide to use decorator 5.0.9. When upgrading Pyodide in future, check that NetworkX
// works and is compatible with the version of decorator Pyodide ships with.
// See the README.md for instructions on how to upgrade Pyodide.
const PYODIDE_URL = "https://cdn-us1.hash.ai/pyodide-0.17.0-patch/";

// We need to keep the behavior and initalizer namespaces in a central location such
// that they all can be updated together (e.g. for updating globals and datasets)
class NamespaceMap {
  namespaces = new Map<string, PyProxy>();

  /** Initialize a new namespace with a given name. */
  async new(name: string): Promise<PyProxy> {
    const ns = await initPythonNamespace();
    this.namespaces.set(name, ns);
    return ns;
  }

  /** Apply a function to each namespace in the collection. */
  async applyAll(f: (ns: PyProxy) => void) {
    for (const ns of this.namespaces.values()) {
      f(ns);
    }
  }
}

export const globalNamespaces = new NamespaceMap();

// Create the wrappers that will be exposed to the behaviors
export const pyStateWrapper = new PyStateWrapper();
export const pyContextWrapper = new PyContextWrapper();

export type HashPyodide = Pyodide;

export interface LoadConfig {
  indexURL: string;
}

// When getPyodideLoader is called, it creates the global objects described by this
// interface.
declare global {
  interface Window {
    loadPyodide(config: LoadConfig): Promise<Pyodide>;
    pyodide: Pyodide;
  }
}

export let runnerPython: Pyodide | null = null;

// runPythonNamespaced is like the Pyodide built-in runPythonAsync, except it accepts
// a namespace to execute the code inside, rather than using the Pyodide global namespace.
// The implementation is based on:
// https://pyodide.org/en/stable/usage/faq.html#how-can-i-change-the-behavior-of-runpython-and-runpythonasync
export const runPythonNamespaced = async (
  code: string,
  namespace: PyProxy,
  messageCallback?: MessageCallback,
  errorCallback?: ErrorCallback
): Promise<any> => {
  await runnerPython?.loadPackagesFromImports(
    code,
    messageCallback,
    errorCallback
  );
  const coroutine = runnerPython?.pyodide_py.eval_code_async(code, namespace);
  try {
    const result = await coroutine;
    return result;
  } finally {
    coroutine.destroy();
  }
};

// Set up pyodide
export const buildPyodide = async () => {
  if (
    typeof global === "object" &&
    typeof require === "function" &&
    Object.prototype.hasOwnProperty.call(global,"pythonLoader")
  ) {
    try {
      // @ts-ignore
      runnerPython = await global.pythonLoader();
    } catch (err) {
      console.error("No pyodide loader provided!", err);
    }
  } else {
    getPyodideLoader();
    runnerPython = await self.loadPyodide({ indexURL: PYODIDE_URL });
    console.log(`Using Pyodide ${self.pyodide.version}`);
  }

  return runnerPython!;
};

/** Initialize and return a new namespace for a Python behavior / initializer. */
export const initPythonNamespace = async () => {
  const namespace = self.pyodide.toPy({});
  await runPythonNamespaced(pyodideInitialize, namespace);

  namespace.set("pystdlibSource", pystdlibsrc);
  namespace.set("pyContextWrapper", pyContextWrapper);
  namespace.set("pyStateWrapper", pyStateWrapper);
  namespace.set("simGlobals", "{}");
  namespace.set("pyStateCache", "{}");
  namespace.set("updateGlobals", true);

  await runPythonNamespaced(loadPystdlib, namespace);
  await runPythonNamespaced(pyodideWrapperInit, namespace);

  return namespace;
};

// We export these utility functions as they bind to this scope.
// Because other files won't see our window/self object, their
// scopes need to be able to call into ours and perform some checks
export const updatePythonGlobals = (globals: string) => {
  if (runnerPython !== null) {
    globalNamespaces.applyAll((ns: PyProxy) => {
      ns.set("simGlobals", globals);
      // Tell python that it needs to update
      ns.set("updateGlobals", true);
      ns.set("simGlobals", globals);
    });
  }
};

// Update the dataset cache in all namespaces.
export const updatePythonDatasetCache = (datasets: PyProxy) => {
  if (runnerPython !== null) {
    globalNamespaces.applyAll((ns: PyProxy) => {
      ns.set("cached_datasets", datasets);
    });
  }
};

export const isPyodideLoaded = () => runnerPython !== null;
