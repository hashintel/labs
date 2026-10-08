import "./page-sections.css";

/** A page's first line, the story of the net, in the lighter text colour with its label inline. */
export const Context: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <p className="page-context">
      <strong>Context:</strong> {children}
    </p>
  );
};

/** The worked example: Run, Verdict and Explanation, set off as one block. */
export const Example: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="page-example">{children}</div>;
};
