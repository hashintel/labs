import "./file-list.css";

type FileListProps = {
  paths: readonly string[];
  selected: string;
  onSelect: (path: string) => void;
};

/** The emitted files, `net.py` first; the one shown is marked. */
export const FileList: React.FC<FileListProps> = ({ paths, selected, onSelect }) => {
  return (
    <nav className="file-list" aria-label="Emitted files">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          className="file-list__item"
          aria-current={path === selected ? "true" : undefined}
          onClick={() => onSelect(path)}
        >
          {path}
        </button>
      ))}
    </nav>
  );
};
