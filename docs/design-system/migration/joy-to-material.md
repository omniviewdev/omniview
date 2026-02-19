# Joy UI to Material UI Migration

MUI Joy is being phased out in favor of MUI Material. This guide documents the component-by-component mapping for migrating Omniview's frontend from Joy UI to Material UI v7.

> **Related**: [Token Architecture](../foundations/02-token-architecture.md) | [Token Adoption](./token-adoption.md)

---

## Migration Strategy

1. **Define the Omniview token layer first** — the `--ov-*` CSS custom properties, independent of any MUI API
2. **Map tokens to MUI Material's theme** via `createTheme()` with `cssVariables: true`
3. **Migrate components one-by-one** from Joy → Material, ensuring each consumes `--ov-*` tokens
4. **Remove Joy dependency** once all components are migrated

---

## Component Mapping

### Direct Mappings

These components have equivalent APIs and can be swapped with minimal changes:

| Joy Import | Material Import | Notes |
|-----------|----------------|-------|
| `@mui/joy/Typography` | `@mui/material/Typography` | Direct. `level` prop → `variant` prop |
| `@mui/joy/Button` | `@mui/material/Button` | `variant` values differ (see below) |
| `@mui/joy/IconButton` | `@mui/material/IconButton` | Direct |
| `@mui/joy/Chip` | `@mui/material/Chip` | Direct |
| `@mui/joy/Divider` | `@mui/material/Divider` | Direct |
| `@mui/joy/Tooltip` | `@mui/material/Tooltip` | Direct |
| `@mui/joy/Avatar` | `@mui/material/Avatar` | Direct |
| `@mui/joy/Stack` | `@mui/material/Stack` | Direct |
| `@mui/joy/Card` | `@mui/material/Card` | Direct |
| `@mui/joy/CardContent` | `@mui/material/CardContent` | Direct |
| `@mui/joy/Accordion*` | `@mui/material/Accordion*` | Direct |
| `@mui/joy/FormControl` | `@mui/material/FormControl` | Direct |

### API Differences

#### Sheet → Paper / Box

Joy's `Sheet` is a generic surface component. Map based on usage:

| Joy Usage | Material Equivalent |
|-----------|-------------------|
| Elevated/raised surface | `Paper` (has elevation) |
| Flat container with bg | `Box` with `sx={{ bgcolor }}` |
| Layout wrapper | `Box` |

#### Input → TextField

```tsx
// Joy
<Input placeholder="Search..." size="sm" />

// Material
<TextField
  placeholder="Search..."
  size="small"
  variant="outlined"
/>
```

For more control, use `OutlinedInput` directly (no label wrapper).

#### Select → Select

```tsx
// Joy
<Select defaultValue="option1">
  <Option value="option1">Option 1</Option>
  <Option value="option2">Option 2</Option>
</Select>

// Material
<Select defaultValue="option1">
  <MenuItem value="option1">Option 1</MenuItem>
  <MenuItem value="option2">Option 2</MenuItem>
</Select>
```

#### Button Variants

| Joy Variant | Material Equivalent |
|------------|-------------------|
| `solid` | `contained` |
| `outlined` | `outlined` |
| `soft` | Use `outlined` + custom styling, or `contained` with low-opacity bg |
| `plain` | `text` |

#### Tabs

```tsx
// Joy
<Tabs>
  <TabList>
    <Tab>Overview</Tab>
    <Tab>Editor</Tab>
  </TabList>
  <TabPanel>...</TabPanel>
</Tabs>

// Material
<Tabs value={value} onChange={handleChange}>
  <Tab label="Overview" />
  <Tab label="Editor" />
</Tabs>
<TabPanel value={value} index={0}>...</TabPanel>
```

Material's Tab API uses `label` prop instead of children, and tab panels are separate components.

#### Table

```tsx
// Joy
<Table>
  <thead><tr><th>Name</th></tr></thead>
  <tbody><tr><td>Value</td></tr></tbody>
</Table>

// Material
<Table>
  <TableHead>
    <TableRow><TableCell>Name</TableCell></TableRow>
  </TableHead>
  <TableBody>
    <TableRow><TableCell>Value</TableCell></TableRow>
  </TableBody>
</Table>
```

Material uses component wrappers (`TableHead`, `TableRow`, `TableCell`) instead of raw HTML elements.

#### Grid

Joy's Grid maps to Material's Grid (v2 in MUI v7):

```tsx
// Joy
<Grid container spacing={2}>
  <Grid xs={6}>...</Grid>
</Grid>

// Material v7 (Grid v2)
<Grid container spacing={2}>
  <Grid size={6}>...</Grid>
</Grid>
```

---

## Theme Migration

### Before (Joy)

```typescript
import { extendTheme } from '@mui/joy/styles';

const theme = extendTheme({
  colorSchemes: {
    dark: {
      palette: {
        background: { body: '#0D1117', surface: '#151B23' },
        text: { primary: '#CBD5E1' },
      },
    },
  },
});
```

### After (Material v7)

```typescript
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    background: {
      default: 'var(--ov-bg-base)',
      paper:   'var(--ov-bg-surface)',
    },
    text: {
      primary:   'var(--ov-fg-default)',
      secondary: 'var(--ov-fg-muted)',
      disabled:  'var(--ov-fg-disabled)',
    },
    primary:  { main: 'var(--ov-accent)' },
    error:    { main: 'var(--ov-danger-default)' },
    warning:  { main: 'var(--ov-warning-default)' },
    success:  { main: 'var(--ov-success-default)' },
    info:     { main: 'var(--ov-info-default)' },
    divider:  'var(--ov-border-default)',
  },
  typography: {
    fontFamily: 'var(--ov-font-ui)',
    fontSize: 14,
  },
  shape: {
    borderRadius: 6,
  },
});
```

### App Provider

```tsx
// Before (Joy + Material dual setup)
<MaterialCssVarsProvider>
  <CssVarsProvider theme={joyTheme}>
    <App />
  </CssVarsProvider>
</MaterialCssVarsProvider>

// After (Material v7 only)
<ThemeProvider theme={materialTheme}>
  <CssBaseline />
  <App />
</ThemeProvider>
```

---

## Federation Layer

The shared packages configuration must be updated to remove Joy and add Material subpath exports:

### Remove

```
@mui/joy
@mui/joy/Accordion
@mui/joy/AccordionDetails
... (all @mui/joy/* entries)
@mui/base
@mui/base/Unstable_Popup
```

### Keep / Add

```
@mui/material
@mui/material/utils
@mui/icons-material
@mui/x-charts
```

After updating, regenerate shims:
```bash
pnpm --filter @omniviewdev/vite-plugin generate-shims
```

---

## Migration Checklist

- [ ] Create `tokens.css` with all `--ov-*` custom properties
- [ ] Import `tokens.css` at app entry point
- [ ] Install `@mui/material` v7
- [ ] Create new theme with `createTheme()` + `cssVariables: true`
- [ ] Update `App.tsx` to use single `ThemeProvider`
- [ ] Migrate host app components (one type at a time)
- [ ] Update federation shared packages
- [ ] Regenerate plugin shims
- [ ] Migrate plugin UIs (kubernetes, aws)
- [ ] Remove `@mui/joy` and `@mui/base` from all `package.json` files
- [ ] Verify all plugins load correctly

> See [Token Adoption](./token-adoption.md) for how to convert hardcoded styles to tokens.
