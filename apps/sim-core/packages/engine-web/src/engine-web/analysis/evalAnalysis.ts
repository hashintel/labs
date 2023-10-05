import { AgentState, OutputDefinition, OutputFn, OutputSeries } from "../../";
import { Comparison, EvalError, Op } from "../simulation";
import { PlotDefinition } from "./plots";

export function evalAnalysis(
  analysisSrc: string
): {
  outputs: OutputDefinition[];
  plots: PlotDefinition[];
} {
  if (!analysisSrc) {
    return {
      outputs: [],
      plots: [],
    };
  }

  try {
    const parsed: {
      plots?: PlotDefinition[];
      outputs?: { [key: string]: Op[] };
    } = JSON.parse(analysisSrc);

    return {
      outputs: Object.entries(parsed.outputs ?? {})
        // expand filter values into their own ops, keeping current ops as single value arrays
        .map(
          (entry) =>
            [
              entry[0],
              entry[1].map((op) =>
                op.op === "filter" && Array.isArray(op.value)
                  ? op.value.map((val) => ({ ...op, value: val }))
                  : [op]
              ),
            ] as [string, Op[][]]
        )
        .flatMap(
          (entry: [string, Op[][]]) =>
            entry[1].reduce(
              (ops: [string, Op[]][], op: Op[]): [string, Op[]][] =>
                // flatMap to reduce the entries into a single map
                ops.flatMap(([name, opsa]: [string, Op[]]): [string, Op[]][] =>
                  //  Expand the filtered ops above into their own entries
                  op.length > 1
                    ? // for each op, create an entry that contains all the previous ops and a new name of the filter value
                      op.map(
                        (op) =>
                          [
                            name + "_" + (op as { value: any }).value!,
                            opsa.concat([op]),
                          ] as [string, Op[]]
                      )
                    : // if it's just a single op, concat it to all the entries so far
                      [[name, opsa.concat(op)]]
                ),
              /* start with just the name */ [[entry[0], []]] as [
                string,
                Op[]
              ][]
            ) as [string, Op[]][]
        )
        .map(([name, ops]: [string, Op[]]) => ({
          name,
          fn: opChain(ops),
        })),
      plots:
        parsed.plots?.map(
          (plotDefinition: PlotDefinition, i: number): PlotDefinition => ({
            ...plotDefinition,
            layout: {
              width: ("50%" as unknown) as number, // gross but it works
              height: ("40%" as unknown) as number,
              ...plotDefinition.layout,
            },
            position: {
              x: i % 2 == 0 ? "0%" : "50%",
              y: `${Math.floor(i / 2) * 40}%`,
              ...plotDefinition.position,
            },
          })
        ) ?? [],
    };
  } catch (e) {
    throw new EvalError(e, "analysis.json");
  }
}

const nestedAccess = (accessor: string, val: any) =>
  accessor.split(".").reduce((result, prop) => result[prop], val);

function opChain(ops: Op[]): OutputFn {
  return ops.reduce(
    (fn, op) => (arr) => OpFn(op)(fn(arr) as any[]),
    ((state: AgentState[]) => state) as (as: any[]) => any[] | number
  );
}

const OpFn = (op: Op): ((as: any[]) => any[] | number) => {
  switch (op.op) {
    case "count":
      return (as: any[]) => as.length;
    case "sum":
      return (as: number[]) => as.reduce((a, b) => a + b, 0);
    case "min":
      return (as: number[]) => Math.min(...as);
    case "max":
      return (as: number[]) => Math.max(...as);
    case "mean":
      return (as: number[]) => as.reduce((a, b) => a + b, 0) / as.length;
    case "movingAverage":
      return (as: number[]) =>
        as.slice(-op.window).reduce((a, b) => a + b, 0) / as.length;
    case "get":
      return (as: any[]) =>
        as.map((a) => a[op.field]).filter((a) => a !== undefined);
    case "filter":
      return (as: any[]) =>
        as.filter((a: any) =>
          ComparisonFn[op.comparison](nestedAccess(op.field, a), op.value)
        );
  }
};

const ComparisonFn: { [K in Comparison]: (a: any, b: any) => boolean } = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  lt: (a, b) => (a as number) < (b as number),
  lte: (a, b) => (a as number) <= (b as number),
  gt: (a, b) => (a as number) > (b as number),
  gte: (a, b) => (a as number) >= (b as number),
};

function outputs(...args: any[]) {
  // args come in pair: name, function.
  const ret = [];
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    let fn = args[i + 1];
    if (fn.done) {
      // if fn is a Chain (defined below)
      fn = fn.done();
    }
    ret.push({
      name,
      fn,
    });
  }

  return ret;
}

function splitBy(field: string, options: any[], rawFn: Function | Chain) {
  const fn = rawFn instanceof Chain ? rawFn.done() : rawFn;

  const ret = [];
  function match(value: any, option: any) {
    if (Array.isArray(value)) {
      return value.includes(option);
    } else {
      return value === option;
    }
  }
  for (const option of options) {
    // name
    ret.push(option);
    ret.push((list: any[], series: any, context: any) => {
      return fn(
        list.filter((a) => match(a[field], option)),
        series,
        context
      );
    });
  }
  return ret;
}

Object.defineProperty(Array.prototype, "suffix", {
  enumerable: true,
  configurable: true,
  writable: true,
  value(suffix: string) {
    this.forEach((_: any, i: number, arr: any[]) => {
      if (i % 2 === 0) {
        arr[i] += suffix;
      }
    });

    return this;
  },
});

Object.defineProperty(Array.prototype, "prefix", {
  enumerable: true,
  configurable: true,
  writable: true,
  value(prefix: string) {
    this.forEach((_: any, i: number, arr: any[]) => {
      if (i % 2 === 0) {
        arr[i] = prefix + arr[i];
      }
    });

    return this;
  },
});

type Transform = (list: any, series: any, context: any) => any;

function exists(x: any) {
  return x !== null && x !== undefined;
}

class Chain {
  private fns: Transform[];

  constructor(fns: Transform[] = [], newFn?: Transform) {
    this.fns = [...fns];
    if (newFn) {
      this.fns.push(newFn);
    }
  }

  done() {
    return (list: any, series: any, context: any) => {
      let output = list;
      for (const fn of this.fns) {
        output = fn(output, series, context);
      }
      return output;
    };
  }

  filterBy(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      return list.filter((el) => el[field] === value);
    });
  }

  count() {
    return new Chain(this.fns, (list: any[]) => list.length);
  }

  get(field: string) {
    return new Chain(this.fns, (list: any[]) => {
      return list.map((el) => el[field]);
    });
  }

  sum(field?: string) {
    function get(el: any) {
      return field ? el[field] : el;
    }

    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(get(el)));
      return filtered.reduce((acc, el) => acc + get(el), 0);
    });
  }

  mean(field?: string) {
    function get(el: any) {
      return field ? el[field] : el;
    }

    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(get(el)));
      return filtered.reduce((acc, el) => acc + get(el), 0) / filtered.length;
    });
  }

  max(field?: string) {
    function get(el: any) {
      return field ? el[field] : el;
    }

    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(get(el)));
      return filtered.reduce((acc, el) => Math.max(acc, get(el)), -Infinity);
    });
  }

  min(field?: string) {
    function get(el: any) {
      return field ? el[field] : el;
    }

    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(get(el)));
      return filtered.reduce((acc, el) => Math.min(acc, get(el)), Infinity);
    });
  }

  lt(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(el[field]));
      return filtered.filter((el) => el[field] < value);
    });
  }

  lte(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(el[field]));
      return filtered.filter((el) => el[field] <= value);
    });
  }

  eq(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      return list.filter((el) => el[field] === value);
    });
  }

  gt(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(el[field]));
      return filtered.filter((el) => el[field] > value);
    });
  }

  gte(field: string, value: any) {
    return new Chain(this.fns, (list: any[]) => {
      const filtered = list.filter((el) => exists(el[field]));
      return filtered.filter((el) => el[field] >= value);
    });
  }

  movingAverage(output: string, options = { window: 15 }) {
    return new Chain(this.fns, (_, series: OutputSeries) => {
      const slice = series[output].slice(-options.window);
      return (
        slice.reduce<number>(
          (acc, x) => acc + (x && !(x instanceof Array) ? x : 0),
          0
        ) / slice.length
      );
    });
  }
}
