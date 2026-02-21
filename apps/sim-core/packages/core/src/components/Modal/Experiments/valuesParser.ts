import { Parser } from "acorn";
import { combine, err, ok } from "neverthrow";

import { ParseResult } from "./types";

// Used to force input to become a sequence expression.
// This is better than wrapping in a list (square brackets)
// whereby error positions can become uninformative
const modifier = {
  _modifier: "_,",
  len_modifier: () => modifier._modifier.length,
  modify: (input: string): string => modifier._modifier + input,
  unmodify: (seqExp: string): string =>
    seqExp.substring(modifier.len_modifier()),
  unmodifyExpressionList: (list: any[]) => list.slice(1),
};

const wrapSubstringInQuotes = (
  input: string,
  from: number,
  to: number,
): string => {
  const checkedMin = Math.min(from, to, input.length);
  const checkedMax = Math.max(from, to, 0);
  return (
    input.substring(0, checkedMin) +
    '"' +
    input.substring(checkedMin, checkedMax) +
    '"' +
    input.substring(checkedMax)
  );
};

const numberMatch = /([+-]?\d+(?:\.\d*)?|(?:\.\d+))/;
const numberPat = new RegExp(
  /^\s*/.source + numberMatch.source + /\s*$/.source,
);
const rangePat = new RegExp(
  /^\s*/.source +
    numberMatch.source +
    /\s*-\s*/.source +
    numberMatch.source +
    /\s*$/.source,
);
const isNumber = (value: string): boolean => numberPat.test(value);
export const isRange = (value: string): boolean => rangePat.test(value);

const specialResolvers = {
  idDirectlyAfterNumber: (values: string, error: SyntaxError): string => {
    const endColumnNumber = (error as any).raisedAt; // accounting for unwrap
    const [part1] = values.slice(0, endColumnNumber).split(",").slice(-1);
    const part2 = values.slice(endColumnNumber).split(",")[0];
    return (
      values.substring(0, endColumnNumber - part1.length) +
      '"' +
      (part1 + part2).trim() +
      '"' +
      values.substring(endColumnNumber + part2.length)
    );
  },
};

const specialTransformers = {
  stringifyIdentifiers: (value: string): string => {
    // Wrapped as a list to help distinguish between objects and block expressions
    const node = (Parser.parse("[" + value + "]") as any).body[0].expression
      .elements[0];
    specialTransformers
      ._gatherIndentifierRanges(node)
      .map(([from, to]) => {
        // Account for initial open bracket
        return [from - 1, to - 1];
      })
      .reverse()
      .forEach(([from, to]) => {
        value = wrapSubstringInQuotes(value, from, to);
      });
    return value;
  },

  // Finds all places where identifiers exist and collects their positions.
  // Returns an ordered list of non-overlapping ranges (care when modifying).
  _gatherIndentifierRanges: (node: any): [number, number][] => {
    const gathered: [number, number][] = [];
    switch (node.type) {
      case "Identifier":
        gathered.push([node.start, node.end]);
        break;
      case "ArrayExpression":
        node.elements.forEach((element: any) =>
          gathered.push(
            ...specialTransformers._gatherIndentifierRanges(element),
          ),
        );
        break;
      case "ObjectExpression":
        node.properties.forEach((property: any) => {
          gathered.push(
            ...specialTransformers._gatherIndentifierRanges(property.key),
          );
          gathered.push(
            ...specialTransformers._gatherIndentifierRanges(property.value),
          );
        });
        break;
    }
    return gathered;
  },
};

const convertParsedValueFromInput = (value: string): ParseResult<any> => {
  if (isNumber(value)) {
    return ok(parseFloat(value));
  }
  try {
    const obj = JSON.parse(value);
    return ok(obj);
  } catch (error) {}

  return ok(value.trim());
};

const parseValues = (values: string): ParseResult<any[]> => {
  // Assuming we're dealing with a list
  let modified = modifier.modify(values);
  let parsed: any[];
  let remainingRetries = 100;
  while (true) {
    try {
      parsed = (Parser.parse(modified) as any).body[0].expression.expressions;
      break;
    } catch (error) {
      if (remainingRetries === 0) {
        console.warn(
          `Exceeded number of retries for parsing values: ${values}`,
        );
        return err({ msg: "Invalid element data" });
      }
      remainingRetries -= 1;
      if (
        error instanceof SyntaxError &&
        error.message.includes("Identifier directly after number")
      ) {
        // Special case for doing a transformation like "3ar, \"a\", 3" => "\"3ar\", \"a\", 3"
        modified = specialResolvers.idDirectlyAfterNumber(modified, error);
        continue;
      }

      if ((error as any).pos) {
        const modPos = (error as any).pos as number;
        const position = modPos - 1; // Account for wrap
        return err({
          msg: `Invalid value at character \'${modified[modPos]}\' [${position}]`,
        });
      }

      return err({ msg: "Invalid element data" });
    }
  }

  const mappedModified = parsed.map((value: any) =>
    specialTransformers.stringifyIdentifiers(
      modified.slice(value.start, value.end),
    ),
  );
  return ok(modifier.unmodifyExpressionList(mappedModified));
};

export const parseValuesFromInput = (values: string): ParseResult<any[]> =>
  parseValues(values).andThen((arr) =>
    combine(arr.map(convertParsedValueFromInput)),
  );

export const serializeParsedValues = (values: any[]): string =>
  values
    .map((value) => {
      if (typeof value !== "number") {
        // Strings should be wrapped in additional quotes
        // and complex objects should be stringified too
        return JSON.stringify(value);
      }
      return value;
    })
    .join(",");
