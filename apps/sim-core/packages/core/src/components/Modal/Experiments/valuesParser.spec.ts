import { ok } from "neverthrow";

import {
  isRange,
  parseValuesFromInput,
  serializeParsedValues,
} from "./valuesParser";

test("valuesParser numbers", () =>
  expect(parseValuesFromInput('234, "234"')).toEqual(ok([234, "234"])));

test("valuesParser strings", () =>
  expect(parseValuesFromInput(' abc , "abc"')).toEqual(ok(["abc", "abc"])));

describe("valuesParser JSON", () => {
  test("list of strings", () =>
    expect(parseValuesFromInput('["a", "b"]')).toEqual(ok([["a", "b"]])));

  test("list with identifiers", () =>
    expect(parseValuesFromInput("[a, b, c]")).toEqual(ok([["a", "b", "c"]])));

  test("dictionary with number", () =>
    expect(parseValuesFromInput('{"a": 3}')).toEqual(ok([{ a: 3 }])));

  test("dictionary with identifier key", () =>
    expect(parseValuesFromInput("{a: 3}")).toEqual(ok([{ a: 3 }])));

  test("dictionary with identifier value", () =>
    expect(parseValuesFromInput('{"a ": c}')).toEqual(ok([{ "a ": "c" }])));

  test("complex with commas", () =>
    expect(
      parseValuesFromInput(
        ' abc, 123abc, [a, b, c], abc123, 123, "123", "abc", {"a": [1, 2, 3, "f", c, {a: abcv32}]}, 1, "\\"test\\""'
      )
    ).toEqual(
      ok([
        "abc",
        "123abc",
        ["a", "b", "c"],
        "abc123",
        123,
        "123",
        "abc",
        { a: [1, 2, 3, "f", "c", { a: "abcv32" }] },
        1,
        '"test"',
      ])
    ));
});

describe("valuesParser range matching", () => {
  test("range 1", () =>
    expect(isRange("  -10.768   -   -3.234234  ")).toBe(true));

  test("range 2", () => expect(isRange("-.768-89.234234  ")).toBe(false));

  test("range 3", () => expect(isRange("-.768-+.234234")).toBe(false));

  test("range 4", () => expect(isRange("--768   -   -3.234234  ")).toBe(false));

  test("range 5", () => expect(isRange("1-1  ")).toBe(true));

  test("range 6", () => expect(isRange(" 1---1")).toBe(false));

  test("range 7", () => expect(isRange("-12.12 - 13")).toBe(true));
});

test("valuesParser top-level resolver idDirectlyAfterNumber", () =>
  expect(parseValuesFromInput("3abc")).toEqual(ok(["3abc"])));

test("valuesParser inverse soundness", () => {
  const parsed = parseValuesFromInput(
    ' abc, 123abc, [a, b, c], abc123, 123, "123", "abc", {"a": [1, 2, 3, "f", c, {a: abcv32}]}, 1, "\\"test\\""'
  );
  expect(parsed).toEqual(
    parseValuesFromInput(serializeParsedValues(parsed.unwrapOr([])))
  );
});
