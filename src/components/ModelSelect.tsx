import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

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
  const { data, isFetching, isError, refetch } = useAvailableModels();
  const [isOpen, setIsOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const options = useMemo<ModelOption[]>(() => {
    const optionMap = new Map<string, ModelOption>();

    data?.forEach((provider) => {
      const providerName = provider.providerName?.trim() || provider.providerId;
      const providerLabel =
        provider.providerId === "openai"
          ? `${providerName} (${provider.credentialType === "oauth" ? "ChatGPT 로그인" : "API 키"})`
          : providerName;

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

    return Array.from(optionMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [data]);

  const filteredOptions = useMemo(() => {
    const normalizedValue = normalizeText(value);
    if (!isFiltering || !normalizedValue) {
      return options;
    }

    return options.filter((option) => option.searchText.includes(normalizedValue));
  }, [isFiltering, options, value]);

  const highlightedOption = filteredOptions[highlightedIndex] ?? null;
  const hasFallbackOptions = data?.some(
    (provider) => provider.source === "fallback" && provider.models.length > 0
  );

  function getListStatus() {
    if (isFetching)
      return hasFallbackOptions
        ? "기본 목록을 표시하고 있습니다. 연결된 공급자의 모델을 확인하는 중입니다."
        : "모델 목록을 불러오는 중입니다.";
    if (isError) return "모델 목록을 갱신하지 못했습니다.";
    if (!data?.length) return "연결된 공급자가 없습니다. Providers에서 연결해 주세요.";
    if (options.length === 0)
      return data.some((provider) => provider.source === "fallback")
        ? "모델 목록을 불러오지 못했습니다. 모델 ID를 직접 입력할 수 있습니다."
        : "표시할 모델이 없습니다. 모델 ID를 직접 입력할 수 있습니다.";
    if (filteredOptions.length === 0)
      return "검색 결과가 없습니다. 모델 ID를 직접 입력할 수 있습니다.";
    return hasFallbackOptions
      ? `${filteredOptions.length}개의 모델 · 기본 목록 포함 (계정에 따라 사용 가능 여부가 다릅니다.)`
      : `${filteredOptions.length}개의 모델`;
  }

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

  const openOptions = () => {
    // 저장된 모델 ID는 유지하고 사용자가 검색어를 입력한 뒤에만 목록을 좁힙니다.
    setIsFiltering(false);
    setHighlightedIndex(-1);
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openOptions();
        setHighlightedIndex(event.key === "ArrowDown" ? 0 : options.length - 1);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) =>
        prev < 0 ? filteredOptions.length - 1 : Math.max(prev - 1, 0)
      );
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
            setIsFiltering(true);
            setHighlightedIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => !isOpen && openOptions()}
          onClick={() => !isOpen && openOptions()}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen && filteredOptions.length > 0 ? listboxId : undefined}
          aria-activedescendant={
            isOpen && highlightedOption ? `${listboxId}-${highlightedIndex}` : undefined
          }
          role="combobox"
          disabled={disabled}
        />
        <button
          type="button"
          className="model-select-toggle"
          aria-label={`${ariaLabel} 목록 ${isOpen ? "닫기" : "열기"}`}
          aria-expanded={isOpen}
          onClick={() => (isOpen ? setIsOpen(false) : openOptions())}
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
            <span role="status">{getListStatus()}</span>
            <button
              type="button"
              className="model-select-refresh"
              aria-label="모델 목록 새로고침"
              title="모델 목록 새로고침"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                refresh
              </span>
            </button>
          </div>

          {filteredOptions.length > 0 && (
            <div
              id={listboxId}
              className="model-select-options"
              role="listbox"
              aria-label={ariaLabel}
            >
              {filteredOptions.map((option, index) => {
                const isSelected = option.value === value.trim();
                const isHighlighted = index === highlightedIndex;

                return (
                  <button
                    key={option.value}
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    title={option.value}
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
