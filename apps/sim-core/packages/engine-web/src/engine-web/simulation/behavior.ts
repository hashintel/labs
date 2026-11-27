import * as hash_stdlib from "../../stdlib/ts/stdlib";
import { BehaviorFn } from "../../glue";
import { EvalError } from "./EvalError";
import { PyProxy } from "./python/pyodideTypes";
import {
  buildPyodide,
  globalNamespaces,
  initPythonNamespace,
  isPyodideLoaded,
  pyContextWrapper,
  pyStateWrapper,
  runPythonNamespaced,
} from "./buildpython";

/** Load a Python's behavior code into a namespace. Returns the behavior function. */
const loadBehavior = async (code: string, namespace: PyProxy) => {
  const wrap = `${code}\nwrap(behavior)`;
  return await runPythonNamespaced(wrap, namespace);
};

/**
 * Create a new BehaviorFn by evaluating the source and potentially loading pyodide
 *
 * @param fileName Full name of the file with extension
 * @param behaviorCode The source code of the behavior
 */
export const getBehaviorFn = async (
  fileName: string,
  behaviorCode: string
): Promise<BehaviorFn> => {
  const extension = fileName.split(".").pop();

  switch (extension) {
    case "rs":
      return () => {
        /**
         * This behavior is required (to successfully return a BehaviorFn), but
         * never actually run because the engine swaps out this code for the
         * actually rust built-in
         */
        throw new EvalError("Rust behavior not parsed", fileName);
      };

    case "js":
      const fn = new Function(
        "hash_stdlib",
        "hstd",
        `${behaviorCode}\n return behavior`
      )(hash_stdlib, hash_stdlib);

      // Return the behavior closure
      return (state, context) => {
        try {
          fn(state, context);
        } catch (e) {
          throw new EvalError(e, fileName);
        }
      };

    case "py":
      if (!isPyodideLoaded()) {
        await buildPyodide();
      }

      const namespace = await globalNamespaces.new(fileName);

      try {
        const pyfn = await loadBehavior(behaviorCode, namespace);

        // Return a closure that calls into our global scope
        return (state, context) => {
          pyStateWrapper.currentState = state;
          pyContextWrapper.context = context;
          namespace.set("currentStep", context.step());
          try {
            pyfn();
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
      throw new Error("Couldn't parse code of unknown filetype");
  }
};
