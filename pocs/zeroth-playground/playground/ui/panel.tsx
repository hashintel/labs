import "./panel.css";

/**
 * How a panel folds: toward the edge of its stack it sits against. `bottom`
 * is a panel in a vertical stack, which folds to its head row; `start` and
 * `end` are a panel in a horizontal stack, which folds to a narrow strip with
 * its title written upright.
 */
export type PanelFold = {
  edge: "bottom" | "start" | "end";
  collapsed: boolean;
  onToggle: () => void;
};

type PanelProps = {
  title: string;
  /** Absent for a panel that does not fold. */
  fold?: PanelFold;
  /** Controls at the right of the head, hidden while the panel is folded. */
  actions?: React.ReactNode;
  children: React.ReactNode;
};

/** Where the chevron points: toward the edge while open, back out once folded. */
function chevronDirection({ edge, collapsed }: PanelFold): "up" | "down" | "left" | "right" {
  switch (edge) {
    case "bottom":
      return collapsed ? "up" : "down";
    case "start":
      return collapsed ? "right" : "left";
    case "end":
      return collapsed ? "left" : "right";
  }
}

/**
 * The frame of every view: a head with the title over the body. A panel that
 * folds puts its title in a toggle whose chevron turns as it opens and
 * closes. Folded, the head stays and the title with it, written upright when
 * the panel folds against a side; the body fades out and takes no focus.
 * Actions sit at the right of the head.
 */
export const Panel: React.FC<PanelProps> = ({ title, fold, actions, children }) => {
  const collapsed = fold?.collapsed ?? false;
  const stack = fold === undefined || fold.edge === "bottom" ? "vertical" : "horizontal";
  return (
    <section className="panel" data-stack={stack} data-collapsed={collapsed} aria-label={title}>
      <header className="panel__head">
        {fold === undefined ? (
          <span className="caps panel__title">{title}</span>
        ) : (
          <button
            type="button"
            className="panel__toggle"
            aria-expanded={!collapsed}
            title={`${collapsed ? "Show" : "Hide"} the ${title.toLowerCase()}`}
            onClick={fold.onToggle}
          >
            <span className="panel__chevron" data-points={chevronDirection(fold)} aria-hidden="true" />
            <span className="caps panel__title">{title}</span>
          </button>
        )}
        {actions === undefined ? null : <div className="panel__actions">{actions}</div>}
      </header>
      <div className="panel__body" inert={collapsed}>
        {children}
      </div>
    </section>
  );
};
