type OpenQuestionProps = {
  /** Who can settle it. */
  owner: "HASH" | "Zeroth" | "HASH and Zeroth";
  /** The question, and why it matters for this net. */
  children: React.ReactNode;
};

/** A question the page leaves open, set apart in amber with whoever can answer it. */
export const OpenQuestion: React.FC<OpenQuestionProps> = ({ owner, children }) => {
  return (
    <aside className="open-question">
      <span className="open-question__owner">For {owner}</span>
      <div className="open-question__body">{children}</div>
    </aside>
  );
};
