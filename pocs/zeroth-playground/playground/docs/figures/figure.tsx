import "./figure.css";

type FigureProps = {
  /** What the figure shows, read under it and by screen readers. */
  caption: string;
  /** The drawing, from the example's `components/` folder. */
  children: React.ReactNode;
};

/** The frame every figure on a page shares: the drawing, then its caption. */
export const Figure: React.FC<FigureProps> = ({ caption, children }) => {
  return (
    <figure className="figure">
      {children}
      <figcaption className="figure__caption">{caption}</figcaption>
    </figure>
  );
};
