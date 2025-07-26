import Bowser from "bowser";

type Action = "parsing" | "running";
type Trace = {
  line: number | undefined;
  column: number | undefined;
  message: string;
};

// we cannot extend Error because otherwise Comlink drops all the fields
export class EvalError {
  public message: string;
  public readonly context: string;
  public readonly action: Action;
  public readonly line?: number;
  public readonly column?: number;

  constructor(original: any, context: string, is_python?: boolean) {
    const action: Action =
      original instanceof SyntaxError ? "parsing" : "running";

    let trace;
    // SyntaxErrors do not report the line number inside the eval block,
    // but Monaco highlights the error! So not everything is lost.
    if (action === "running" && original.stack) {
      try {
        if (is_python) {
          // Pyodide converts Python exceptions to a pyodide.PythonError. It stores the
          // actual Python stacktrace in the 'message' field.
          trace = parsePythonStack(original.message);
        } else {
          trace = parseStack(original.stack, original);
        }
      } catch (e) {
        console.error(
          "Could not parse error stack correctly: " + original.stack,
        );
        console.error(e);
      }
    }
    if (!trace) {
      const origMessage = extractOriginalMessage(original);
      this.message = `${action} ${context}: ${origMessage}`;
    } else if (trace.line && trace.column) {
      this.line = trace.line;
      this.column = trace.column;
      this.message = `${action} ${context} at ${trace.line}:${trace.column}: ${trace.message}`;
    } else if (trace.line) {
      this.line = trace.line;
      this.message = `${action} ${context} at ${trace.line}: ${trace.message}`;
    } else {
      this.message = `${action} ${context}: ${trace.message}`;
    }
    this.context = context;
    this.action = action;
  }
}

function extractOriginalMessage(original: any): string {
  if (typeof original === "string") {
    return original;
  }

  if (original instanceof Error) {
    return original.toString();
  }

  return original.message;
}

function parseStack(stack: string, original: any): Trace {
  let searchStr = "<anonymous>";
  if (typeof navigator !== "undefined") {
    const browser = Bowser.getParser(navigator.userAgent);
    searchStr = browser.is("chrome") ? "<anonymous>" : "> Function";
  }

  let data = stack.split("\n").find((line) => line.includes(searchStr))!;
  data = data.slice(data.lastIndexOf(searchStr));
  const [line, column] = data
    .split(":")
    .slice(1)
    .map((v) => parseInt(v));

  const message = extractOriginalMessage(original);
  return {
    line: line - 2, // Account for Function
    column: column,
    message: message,
  };
}

// Parses single line of Python trace.
// TODO: Remove "<exec>" to make Python errors less verbose.
const fixPyFrame = (pyLine: string): { lineNum: number; fixed: string } => {
  const lineNumPrefix = "line ";
  const iPrefix = pyLine.indexOf(lineNumPrefix);
  if (iPrefix < 0) {
    throw new Error("Couldn't find line number in Python trace");
  }

  const iLineNum = iPrefix + lineNumPrefix.length;
  let lineNumEnd = pyLine.indexOf(",", iLineNum);
  if (lineNumEnd < 0) lineNumEnd = pyLine.length;

  const lineNum = parseInt(pyLine.slice(iLineNum, lineNumEnd));
  const fixed = pyLine.slice(0, iLineNum) + lineNum + pyLine.slice(lineNumEnd);
  return { lineNum: lineNum, fixed: fixed };
};

const lastIndexOfPythonStack = (lines: string[]): number => {
  let pyLast = lines.length - 1;
  if (pyLast < 0) {
    throw new Error("Python trace is empty");
  }
  while (true) {
    // JavaScript exceptions contain `at ...` for each stack frame.
    if (!lines[pyLast].trimLeft().startsWith("at")) break;

    if (pyLast === 0) {
      throw new Error("Couldn't find Python trace");
    }
    pyLast -= 1;
  }
  return pyLast;
};

function parsePythonStack(stack: string): Trace {
  const lines = stack.split("\n");
  const pyLast = lastIndexOfPythonStack(lines);
  const pyLines = lines.slice(0, pyLast + 1);

  let behaviorLineNum;
  for (var i = 0; i < pyLines.length; ++i) {
    try {
      const frame = fixPyFrame(pyLines[i]);
      pyLines[i] = frame.fixed;
      if (pyLines[i].trimRight().endsWith(" behavior")) {
        behaviorLineNum = frame.lineNum;
      }
    } catch (e) {
      // Ignore -- some lines in Python trace aren't stack frames.
    }
  }

  const message = pyLines.join("\n");
  return {
    // `line` is `undefined` if the error didn't contain a
    // behavior function -- e.g. if the error happened when
    // loading behaviors.
    line: behaviorLineNum,
    // At least for now, Python doesn't show column numbers.
    column: undefined,
    message: message,
  };
}
