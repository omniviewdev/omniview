import { useState, useMemo } from "react";
import MuiSelect from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import FormHelperText from "@mui/material/FormHelperText";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import OutlinedInput from "@mui/material/OutlinedInput";
import InputBase from "@mui/material/InputBase";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import type { SxProps, Theme } from "@mui/material/styles";
import type { SelectChangeEvent } from "@mui/material/Select";

import type { SemanticColor, ComponentSize } from "../types";
import { toMuiInputSize, toMuiColor, INPUT_HEIGHTS } from "../types";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface SelectProps {
  options: SelectOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  label?: string;
  helperText?: string;
  placeholder?: string;
  searchable?: boolean;
  multiple?: boolean;
  loading?: boolean;
  error?: boolean | string;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Show delete buttons on chips and a clear-all icon (multiple mode only) */
  clearable?: boolean;
  sx?: SxProps<Theme>;
}

export default function Select({
  options,
  value,
  onChange,
  size = "md",
  color = "neutral",
  label,
  helperText,
  placeholder,
  searchable = false,
  multiple = false,
  loading = false,
  error,
  fullWidth,
  disabled,
  clearable = false,
  sx,
}: SelectProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const muiSize = toMuiInputSize(size);
  const muiColor = toMuiColor(color) as any;
  const hasError = typeof error === "string" ? !!error : error;
  const errorText = typeof error === "string" ? error : undefined;

  const closeAndReset = () => {
    setIsOpen(false);
    setFocusedIndex(-1);
    if (searchable) setSearch("");
  };

  const filteredOptions = useMemo(() => {
    if (!searchable || !search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search, searchable]);

  const handleChange = (e: SelectChangeEvent<string | string[]>) => {
    onChange(e.target.value);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      closeAndReset();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (filteredOptions.length === 0) return;
      const next = focusedIndex + 1;
      setFocusedIndex(next >= filteredOptions.length ? 0 : next);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const prev = focusedIndex - 1;
      setFocusedIndex(prev < 0 ? filteredOptions.length - 1 : prev);
      return;
    }

    if (
      e.key === "Enter" &&
      focusedIndex >= 0 &&
      focusedIndex < filteredOptions.length
    ) {
      e.preventDefault();
      e.stopPropagation();
      const opt = filteredOptions[focusedIndex];
      if (!opt.disabled) {
        if (multiple) {
          const arr = Array.isArray(value) ? value : [];
          const newValue = arr.includes(opt.value)
            ? arr.filter((v) => v !== opt.value)
            : [...arr, opt.value];
          onChange(newValue);
        } else {
          onChange(opt.value);
          closeAndReset();
        }
      }
      return;
    }

    e.stopPropagation();
  };

  return (
    <FormControl
      size={muiSize}
      fullWidth={fullWidth}
      error={hasError}
      disabled={disabled}
      style={
        { "--ov-input-height": INPUT_HEIGHTS[size] } as React.CSSProperties
      }
      sx={sx}
    >
      {label && (
        <InputLabel
          color={
            muiColor === "default" || muiColor === "inherit"
              ? undefined
              : muiColor
          }
          shrink={!!placeholder || undefined}
        >
          {label}
        </InputLabel>
      )}
      <MuiSelect
        value={value}
        onChange={handleChange}
        multiple={multiple}
        displayEmpty={!!placeholder}
        label={label}
        notched={label ? !!placeholder || undefined : undefined}
        input={multiple ? <OutlinedInput label={label} /> : undefined}
        open={isOpen}
        onOpen={() => {
          setIsOpen(true);
          setFocusedIndex(-1);
        }}
        onClose={closeAndReset}
        renderValue={
          multiple
            ? (selected) => {
                const arr = selected as string[];
                if (arr.length === 0 && placeholder) {
                  return (
                    <Box sx={{ color: "var(--ov-fg-faint)" }}>
                      {placeholder}
                    </Box>
                  );
                }
                return (
                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "nowrap",
                      gap: 0.5,
                      overflow: "hidden",
                      alignItems: "center",
                    }}
                  >
                    {arr.map((val) => {
                      const opt = options.find((o) => o.value === val);
                      return (
                        <Chip
                          key={val}
                          label={opt?.label ?? val}
                          size="small"
                          {...(clearable
                            ? {
                                onDelete: (e: React.SyntheticEvent) => {
                                  e.stopPropagation();
                                  onChange(arr.filter((v) => v !== val));
                                },
                                onMouseDown: (e: React.MouseEvent) => {
                                  e.stopPropagation();
                                },
                              }
                            : {})}
                        />
                      );
                    })}
                    {clearable && arr.length > 1 && (
                      <button
                        type="button"
                        aria-label="Clear all"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange([]);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          flexShrink: 0,
                          marginLeft: 2,
                          cursor: "pointer",
                          color: "var(--ov-fg-faint)",
                          lineHeight: 0,
                          background: "none",
                          border: "none",
                          padding: 0,
                        }}
                      >
                        <ClearIcon sx={{ fontSize: 16 }} />
                      </button>
                    )}
                  </Box>
                );
              }
            : placeholder && !value
              ? () => (
                  <Box sx={{ color: "var(--ov-fg-faint)" }}>{placeholder}</Box>
                )
              : undefined
        }
        MenuProps={{
          PaperProps: {
            sx: {
              maxHeight: 300,
              ...(size === "xs" || size === "sm"
                ? {
                    "& .MuiMenuItem-root": {
                      fontSize: "0.8rem",
                      minHeight: 28,
                      padding: "3px 8px",
                    },
                    "& .MuiListItemText-root": {
                      margin: 0,
                    },
                    "& .MuiListItemText-primary": {
                      fontSize: "0.8rem",
                    },
                    "& .MuiListItemIcon-root": {
                      minWidth: 22,
                    },
                  }
                : {}),
            },
          },
        }}
      >
        {searchable && (
          <Box
            sx={{ px: 1, pb: 0.5, pt: 0.5 }}
            onClickCapture={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                height: 28,
                border: "1px solid var(--ov-border-default)",
                borderRadius: "4px",
                bgcolor: "var(--ov-bg-base)",
                px: 0.75,
                "&:focus-within": { borderColor: "var(--ov-accent)" },
              }}
            >
              <SearchIcon
                sx={{ fontSize: 14, color: "var(--ov-fg-faint)", mr: 0.5 }}
              />
              <InputBase
                autoFocus
                fullWidth
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFocusedIndex(-1);
                }}
                onKeyDown={handleSearchKeyDown}
                sx={{
                  flex: 1,
                  fontSize: "0.75rem",
                  color: "var(--ov-fg-default)",
                  "& input": { py: 0, px: 0 },
                  "& input::placeholder": {
                    color: "var(--ov-fg-faint)",
                    opacity: 1,
                  },
                }}
              />
            </Box>
          </Box>
        )}
        {loading && (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1 }} /> Loading...
          </MenuItem>
        )}
        {filteredOptions.map((opt, idx) => (
          <MenuItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            onMouseEnter={() => setFocusedIndex(idx)}
            sx={idx === focusedIndex ? { bgcolor: "action.focus" } : undefined}
          >
            {opt.icon && (
              <ListItemIcon sx={{ minWidth: 28 }}>{opt.icon}</ListItemIcon>
            )}
            <ListItemText>{opt.label}</ListItemText>
          </MenuItem>
        ))}
        {filteredOptions.length === 0 && !loading && (
          <MenuItem disabled>No options</MenuItem>
        )}
      </MuiSelect>
      {(errorText || helperText) && (
        <FormHelperText>{errorText ?? helperText}</FormHelperText>
      )}
    </FormControl>
  );
}

Select.displayName = "Select";
