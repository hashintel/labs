import "./back-link.css";

type BackLinkProps = {
  /** An id another element hands the keyboard focus to. */
  id?: string;
  onClick: () => void;
  children: React.ReactNode;
};

/** The way back from a card to the list it came from: a chevron and a label, like a breadcrumb. */
export const BackLink: React.FC<BackLinkProps> = ({ id, onClick, children }) => {
  return (
    <button type="button" id={id} className="caps back-link" onClick={onClick}>
      <span className="back-link__chevron" aria-hidden="true" />
      {children}
    </button>
  );
};
