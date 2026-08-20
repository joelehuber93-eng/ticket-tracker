import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

/** Checkbox dropdown for picking zero or more of a list of string options.
 * An empty selection means "no filter" (everything shows), same convention
 * as the single-select dropdowns it replaced. */
export function MultiSelect({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleOption = (option: string) => {
    const next = new Set(selected);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(next);
  };

  const summary =
    selected.size === 0
      ? `All ${label.toLowerCase()}`
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} ${label.toLowerCase()} selected`;

  return (
    <div className="multiselect" ref={containerRef}>
      <button type="button" className="multiselect-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="multiselect-summary">{summary}</span>
        <span className="multiselect-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="multiselect-panel">
          <div className="multiselect-actions">
            <button type="button" onClick={() => onChange(new Set())}>
              Clear
            </button>
            <button type="button" onClick={() => onChange(new Set(options))}>
              Select all
            </button>
          </div>
          <div className="multiselect-options">
            {options.map((option) => (
              <label key={option} className="multiselect-option">
                <input type="checkbox" checked={selected.has(option)} onChange={() => toggleOption(option)} />
                {option}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
