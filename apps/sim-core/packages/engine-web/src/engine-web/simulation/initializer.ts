import * as hash_stdlib from "../../stdlib/ts/stdlib";
import { EvalError } from "./EvalError";
import { InitFn } from "../../glue";
import { PyProxy } from "./python/pyodideTypes";
import {
  buildPyodide,
  globalNamespaces,
  isPyodideLoaded,
  runPythonNamespaced,
} from "./buildpython";
import { convertToObject } from "./util";

const loadInitializer = async (code: string, ns: PyProxy) => {
  const wrap = `${code}\nwrap_init(init)`;
  return await runPythonNamespaced(wrap, ns);
};

/**
 * Create a new InitFn by evaluating the source and potentially loading pyodide
 *
 * @param fileName Full name of the file with extension
 * @param initCode The source code of the init file (json / js / py).
 */
export const getInitFn = async (
  fileName: string,
  initCode: string
): Promise<InitFn> => {
  const extension = fileName.split(".").pop();

  switch (extension) {
    case "json":
      return (_) => {
        try {
          const agents = JSON.parse(initCode);
          if (!Array.isArray(agents)) {
            throw new Error("must contain an array of agents only");
          }
          return agents;
        } catch (e) {
          throw new EvalError(e, fileName);
        }
      };
    case "js":
      const fn = new Function(
        "hash_stdlib",
        "hstd",
        `${initCode}\nreturn init`
      )(hash_stdlib, hash_stdlib);

      return (context) => {
        try {
          const agents = fn(context);
          if (!Array.isArray(agents)) {
            throw new Error("init must return an array of agents");
          }
          return agents;
        } catch (e) {
          throw new EvalError(e, fileName);
        }
      };
    case "py":
      // Load pyodide if it's not already loaded and then set it up
      if (!isPyodideLoaded()) {
        await buildPyodide();
      }

      const namespace = await globalNamespaces.new("initializer " + fileName);

      try {
        const pyfn = await loadInitializer(initCode, namespace);

        return (_context) => {
          // We don't need to pass the init context object to the pyfn because it's already
          // available in the runner's global scope.
          try {
            // The return type of a Python function called from JS through Pyodide is a
            // PyProxy. A PyProxy can be conveted to a standard JS object using the
            // toJs method, however, this converts Python dictionaries to Js Maps when
            // we need plain objects.
            let agents = pyfn();
            agents = convertToObject(agents.toJs());
            if (!Array.isArray(agents)) {
              throw new Error("init must return an array of agents");
            }
            return agents;
          } catch (e) {
            if (e instanceof EvalError) {
              throw e;
            }
            throw new EvalError(e, fileName, true);
          }
        };
      } catch (e) {
        if (e instanceof EvalError) {
          throw e;
        }
        throw new EvalError(e, fileName, true);
      }

    default:
      throw new Error(`Unsupported init file '${fileName}'`);
  }
};
