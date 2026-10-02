type MarkingProps = {
  /** When the marking holds, as read above it. */
  label: string;
  /** The tokens in each place, in the order the places are drawn. */
  places: readonly { name: string; tokens: number }[];
};

/** A marking drawn as places side by side, each with a dot per token and its name under it. */
export const Marking: React.FC<MarkingProps> = ({ label, places }) => {
  return (
    <div className="one-step__marking">
      <span className="one-step__label">{label}</span>
      <div className="one-step__places">
        {places.map(({ name, tokens }) => (
          <span key={name} className="one-step__place">
            <span className="one-step__circle">
              {Array.from({ length: tokens }, (_, index) => (
                <span key={index} className="one-step__token" />
              ))}
            </span>
            <span className="one-step__name">
              {name} {tokens}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};
