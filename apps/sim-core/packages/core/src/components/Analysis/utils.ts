import { ComparisonTypes } from "./types";
import { ParsedAnalysis } from "../../features/files/types";
import { safeParseJsonTracked } from "../../util/safeParseJsonTracked";

const _flattenError = (error: string): string => {
  const removeAllWhitespacesRegex = /\r?\n|\r/g;
  return error.replace(removeAllWhitespacesRegex, "").replace("  ", " ");
};

// the last part of the error is always the position
const _getErrorPosition = (error: string): number =>
  Number(error.split(" ").pop());

const _getErrorLineInformation = (
  sourceCode: string,
  errorPosition: number
): {
  slicedJsonLines: string[];
  leftSpacePaddingLength: number;
  lineForError: number;
} => {
  // extract since the beginning of the file until the error happens
  const slicedJson = sourceCode?.slice(0, errorPosition);
  let leftSpacePaddingLength = 0;
  let lineForError = 0;
  // split into lines, then start searching for the specific character
  // once the character is found, we'll have lineForError set
  const slicedJsonLines = slicedJson.split("\n");
  let currentChar = 1;
  slicedJsonLines.forEach((line, currentLine) => {
    const lineLength = line.length;
    lineForError = currentLine;
    if (lineLength + currentChar < errorPosition) {
      // the error is not in this line, increase counter and continue
      currentChar += lineLength;
      return;
    }
    const matchingChar = sourceCode?.slice(errorPosition - 1, errorPosition);
    leftSpacePaddingLength = line.substring(0, line.indexOf(matchingChar))
      .length;
  });
  return { slicedJsonLines, leftSpacePaddingLength, lineForError };
};

const _getErrorWithSurroundingCode = ({
  lineForError,
  leftSpacePaddingLength,
  slicedJsonLines,
}: {
  lineForError: number;
  leftSpacePaddingLength: number;
  slicedJsonLines: string[];
}) => {
  const lineForErrorStr = `${lineForError - 1}: `;
  const spacer = " ".repeat(leftSpacePaddingLength + lineForErrorStr.length);
  // TODO: improvements: add line number to the following lines until the error
  // TODO: add heuristic to look for common flaws like missing string literal
  // for example: `{ "outputs:`
  const result = slicedJsonLines
    .slice(lineForError - 2, lineForError)
    .map(
      (item: string, index: number) =>
        `${lineForError - 1 + index}: ${spacer}${item}`
    )
    .join("\n"); // we can comment this line but sometimes the error is way too long

  return `${result} ⟵ The error happened on this line`;
};

export const getHelpForSyntaxError = (
  error: string,
  analysisString?: string
): string => {
  if (!analysisString) {
    return "";
  }
  const flattened = _flattenError(error);
  const errorPosition = _getErrorPosition(flattened);
  if (!errorPosition) {
    return flattened;
  }
  const params = _getErrorLineInformation(analysisString, errorPosition);
  return _getErrorWithSurroundingCode(params);
};

export const getHumanReadableComparison = (op: ComparisonTypes) => {
  switch (op) {
    case ComparisonTypes.eq:
      return "equals";

    case ComparisonTypes.neq:
      return "is not equal to";

    case ComparisonTypes.lt:
      return "is less than";

    case ComparisonTypes.lte:
      return "equals or is less than";

    case ComparisonTypes.gt:
      return "is greater than";

    case ComparisonTypes.gte:
      return "equals or is greater than";

    default:
      return op;
  }
};

export const parseAnalysis = (input?: string) => {
  const result = safeParseJsonTracked<ParsedAnalysis>(input);
  return {
    lastAnalysisString: input,
    analysis: result.parsed,
    error: result.error,
  };
};
