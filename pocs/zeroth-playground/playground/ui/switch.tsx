type SwitchProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Said on hover, to name what the switch does. */
  title?: string;
};

/** An on/off switch: a small track whose knob slides over, and its label beside it. */
export const Switch: React.FC<SwitchProps> = ({ label, checked, onChange, disabled = false, title }) => {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className="switch__track" aria-hidden="true" />
    </button>
  );
};
