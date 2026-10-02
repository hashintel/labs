import "./back-link.css";

type BackLinkProps = {
  /** An id another element hands the keyboard focus to. */
  id?: string;
  /** Where the link goes; without one it is a button that only acts. */
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

/** The way back from a card to the list it came from: a chevron and a label, like a breadcrumb. */
export const BackLink: React.FC<BackLinkProps> = ({ id, href, onClick, children }) => {
  const inner = (
    <>
      <span className="back-link__chevron" aria-hidden="true" />
      {children}
    </>
  );
  return href === undefined ? (
    <button type="button" id={id} className="caps back-link" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <a id={id} href={href} className="caps back-link" onClick={onClick}>
      {inner}
    </a>
  );
};
