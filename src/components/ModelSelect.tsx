import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { getModelCatalog } from "@/config/loadModels";
import { useAvailableModels } from "@/hooks/useAI";

type ModelSelectProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onInteract?: () => void;
};

type ModelOption = {
  value: string;
  label: string;
  providers: string[];
  searchText: string;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function ModelSelect({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
  disabled = false,
  onInteract,
}: ModelSelectProps) {
  const { data, isLoading, isError } = useAvailableModels();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const providerCatalog = useMemo(() => getModelCatalog(), []);

  const options = useMemo<ModelOption[]>(() => {
    const optionMap = new Map<string, ModelOption>();

    data?.forEach((provider) => {
      const providerLabel = providerCatalog[provider.providerId]?.name?.trim() || provider.providerId;

      provider.models.forEach((model) => {
        const modelValue = model.id?.trim();
        if (!modelValue) {
          return;
        }

        const modelLabel = model.name?.trim() || modelValue;
        const existing = optionMap.get(modelValue);
        if (existing) {
          if (!existing.providers.includes(providerLabel)) {
            existing.providers.push(providerLabel);
            existing.searchText = `${existing.searchText} ${normalizeText(providerLabel)}`.trim();
          }
          return;
        }

        optionMap.set(modelValue, {
          value: modelValue,
          label: modelLabel,
          providers: [providerLabel],
          searchText: normalizeText(`${modelValue} ${modelLabel} ${providerLabel}`),
        });
      });
    });

    return Array.from(optionMap.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [data, providerCatalog]);

  const filteredOptions = useMemo(() => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return options;
    }

    return options.filter((option) => option.searchText.includes(normalizedValue));
  }, [options, value]);

  const highlightedOption = filteredOptions[highlightedIndex] ?? null;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const commitOption = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setIsOpen(true);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      if (highlightedOption) {
        event.preventDefault();
        commitOption(highlightedOption.value);
      } else {
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`model-select${className ? ` ${className}` : ""}`}
      onMouseDown={onInteract}
    >
      <div className="model-select-control">
        <input
          type="text"
          className="model-select-input"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          role="combobox"
          disabled={disabled}
        />
        <button
          type="button"
          className="model-select-toggle"
          aria-label={`${ariaLabel} 목록 열기`}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          disabled={disabled}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            unfold_more
          </span>
        </button>
      </div>

      {isOpen && !disabled && (
        <div className="model-select-popover">
          <div className="model-select-status">
            {isLoading
              ? "모델 목록을 불러오는 중입니다."
              : isError
                ? "모델 목록을 불러오지 못했습니다."
                : filteredOptions.length > 0
                  ? `${filteredOptions.length}개의 모델`
                  : "검색 결과가 없습니다. 직접 입력해서 사용할 수 있습니다."}
          </div>

          {!isLoading && !isError && filteredOptions.length > 0 && (
            <div id={listboxId} className="model-select-options" role="listbox" aria-label={ariaLabel}>
              {filteredOptions.map((option, index) => {
                const isSelected = option.value === value.trim();
                const isHighlighted = index === highlightedIndex;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`model-select-option${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => commitOption(option.value)}
                  >
                    <span className="model-select-option-label">{option.label}</span>
                    <span className="model-select-option-meta">{option.providers.join(", ")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
