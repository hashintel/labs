import { useId } from "react";

import { meaningOf } from "./glossary";

import "./term.css";

type TermProps = {
  /** The glossary entry, when the text differs from it, such as "deadlocks" for "deadlock". */
  name?: string;
  children: string;
};

/**
 * A technical term on a page: dotted underline, and its glossary line in a
 * tooltip on hover and on keyboard focus. Throws on a term the glossary
 * lacks, so a page that uses one fails its render test.
 */
export const Term: React.FC<TermProps> = ({ name, children }) => {
  const id = useId();
  const term = name ?? children;
  const meaning = meaningOf(term);
  if (meaning === undefined) {
    throw new Error(`"${term}" is not in playground/docs/glossary.ts`);
  }
  return (
    <span className="term" tabIndex={0} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="term__tip">
        {meaning}
      </span>
    </span>
  );
};
