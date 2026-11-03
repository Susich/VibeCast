import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpDownIcon, CheckIcon, ChevronDownIcon } from "./Icons";

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface CustomDropdownProps<T extends string = string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  icon?: ReactNode;
  className?: string;
}

export function CustomDropdown<T extends string = string>({
  value,
  options,
  onChange,
  title = "Выбор",
  icon = <ArrowUpDownIcon size={14} />,
  className = "",
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const close = useCallback((immediate = false) => {
    clearCloseTimer();
    if (immediate) {
      setIsClosing(false);
      setIsOpen(false);
      return;
    }
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, 160);
  }, [clearCloseTimer]);

  const open = useCallback(() => {
    clearCloseTimer();
    setIsClosing(false);
    setIsOpen(true);
    const idx = options.findIndex((opt) => opt.value === value);
    setHighlightIndex(idx >= 0 ? idx : 0);
  }, [clearCloseTimer, options, value]);

  const toggle = useCallback(() => {
    if (isOpen && !isClosing) {
      close();
    } else {
      open();
    }
  }, [isOpen, isClosing, close, open]);

  const handleSelect = useCallback(
    (optValue: T) => {
      onChange(optValue);
      close();
    },
    [onChange, close],
  );

  // Clear timer on unmount only
  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  // Close on click outside or escape key
  useEffect(() => {
    if (!isOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close]);

  // Keyboard navigation within the dropdown
  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        open();
      } else {
        setHighlightIndex((prev) => (prev + 1) % options.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        open();
      } else {
        setHighlightIndex((prev) => (prev - 1 + options.length) % options.length);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen && !isClosing) {
        const target = options[highlightIndex];
        if (target) {
          handleSelect(target.value);
        } else {
          close();
        }
      } else {
        open();
      }
    } else if (event.key === "Tab" && isOpen) {
      close(true);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`custom-dropdown ${isOpen ? "is-open" : ""} ${isClosing ? "is-closing" : ""} ${className}`}
      onKeyDown={onTriggerKeyDown}
    >
      <button
        type="button"
        className="custom-dropdown-trigger"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={title}
      >
        <span className="custom-dropdown-icon">{icon}</span>
        <span className="custom-dropdown-label">{selectedOption?.label ?? value}</span>
        <ChevronDownIcon size={14} className="custom-dropdown-chevron" />
      </button>

      {(isOpen || isClosing) && (
        <div
          ref={menuRef}
          className={`custom-dropdown-menu ${isClosing ? "menu-exit" : "menu-enter"}`}
          role="listbox"
          aria-label={title}
        >
          {options.map((option, idx) => {
            const isSelected = option.value === value;
            const isHighlighted = idx === highlightIndex;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`custom-dropdown-item ${isSelected ? "selected" : ""} ${isHighlighted ? "highlighted" : ""}`}
                style={{ "--item-idx": idx } as CSSProperties}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                <div className="item-content">
                  {option.icon && <span className="item-icon">{option.icon}</span>}
                  <span className="item-label">{option.label}</span>
                </div>
                {isSelected && (
                  <span className="item-check">
                    <CheckIcon size={13} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
