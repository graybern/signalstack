# Phase 5: Leads Table Redesign

## Context

The Leads table currently has 5 hardcoded columns (Company, Score, Campaign, Feedback, Updated). All dimension scores are crammed into a single `InlineScoreStrip` cell. Users can't show/hide individual dimension columns, and sort is done via a separate `<select>` dropdown rather than clickable headers. This phase introduces a column system with configurable visibility, sortable headers, and a column picker.

## Current State

- **Table header**: 5 hardcoded columns defined inline (Leads.tsx:1351-1366)
- **Table body**: 5 hardcoded `<td>` cells per row (Leads.tsx:1415-1522)
- **Sort**: `<select>` dropdown with `SORT_OPTIONS` array (Leads.tsx:1076-1082), `toggleSort()` at line 653
- **Headers**: Partial click-to-sort on columns with a `key` value, but only 3 of 5 columns are sortable
- **Backend**: Already supports sorting by all dimension fields — `allowedSorts` in leads.ts:117-122 includes `potential_score`, `urgency_score`, `icp_fit_score`, `reachability_score`, `signal_quality_score`, `data_confidence_score`, `evidence_modifier`
- **Lead interface**: Already has `potential_score`, `urgency_score`, `icp_fit_score`, `reachability_score`, `signal_quality_score`, `data_confidence`, `data_confidence_score` fields
- **localStorage pattern**: `signalstack:leads:lastFilters` key, URL params > localStorage > defaults

## Column Definitions

### Always-visible (not toggleable)
| Column | Sort Key | Width | Renders |
|--------|----------|-------|---------|
| Company | `company_name` | flex-1 / min-w-[200px] | Company name link + domain + segment badge |

### Default visible (toggleable)
| Column | Sort Key | Width | Renders |
|--------|----------|-------|---------|
| Score | `fit_score` | w-[160px] | `InlineScoreStrip` (composite + F/I/Ev%) |
| Campaign | — (not sortable) | w-[160px] | Campaign name link |
| Status | `current_feedback` | w-[100px] | Feedback badge OR action label |
| Updated | `created_at` | w-[90px] | Date string |

### Dimension columns (hidden by default, toggleable)
| Column | Sort Key | Width | Renders |
|--------|----------|-------|---------|
| Potential | `potential_score` | w-[80px] | Score number + color-coded bg |
| Urgency | `urgency_score` | w-[80px] | Score number + color-coded bg |
| ICP Fit | `icp_fit_score` | w-[80px] | Score number + color-coded bg |
| Signal Quality | `signal_quality_score` | w-[80px] | Score number + color-coded bg |
| Reachability | `reachability_score` | w-[80px] | Score number + color-coded bg |
| Data Confidence | `data_confidence_score` | w-[80px] | Grade badge (A-F) |
| Segment | — | w-[70px] | Segment badge (separate from Company) |
| Signals | — | w-[70px] | Signal count |

## Steps

- [x] Step 1: Define column configuration array and types
- [x] Step 2: Column visibility state with localStorage persistence
- [x] Step 3: Refactor table header to use column config
- [x] Step 4: Refactor table body to use column config with cell renderers
- [x] Step 5: Column picker popover
- [x] Step 6: Sortable column headers replacing dropdown
- [x] Step 7: TypeScript check + visual verification

## Step Details

### Step 1: Define column configuration array and types
**File**: `packages/web/src/pages/Leads.tsx`

Add above the component, after existing constants:

```typescript
interface ColumnDef {
  id: string;
  label: string;
  sortKey?: string;       // backend sort column name, undefined = not sortable
  width?: string;         // Tailwind width class
  alwaysVisible?: boolean; // can't be toggled off
  defaultVisible?: boolean;
  group?: 'core' | 'dimensions' | 'meta';
  render: (lead: Lead, helpers: RenderHelpers) => React.ReactNode;
}

interface RenderHelpers {
  getFeedback: (lead: Lead) => string | null;
  deriveAction: (lead: Lead) => { action: ActionState | null; cfg: typeof ACTION_CONFIG[ActionState] | null };
  showCheckboxes: boolean;
}
```

Define `COLUMNS: ColumnDef[]` array with all columns from the tables above. Each column has a `render` function that returns the `<td>` contents (not the `<td>` itself — the wrapper handles that).

- Company column: `alwaysVisible: true`, `group: 'core'`
- Score, Campaign, Status, Updated: `defaultVisible: true`, `group: 'core'`
- Potential, Urgency, ICP Fit, Signal Quality, Reachability, Data Confidence: `defaultVisible: false`, `group: 'dimensions'`
- Segment, Signals: `defaultVisible: false`, `group: 'meta'`

### Step 2: Column visibility state with localStorage persistence
**File**: `packages/web/src/pages/Leads.tsx`

```typescript
const COLUMNS_STORAGE_KEY = 'signalstack:leads:columns';

// Inside component:
const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set(COLUMNS.filter(c => c.alwaysVisible || c.defaultVisible).map(c => c.id));
});

// Persist on change:
useEffect(() => {
  localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...visibleColumns]));
}, [visibleColumns]);

// Derived: columns to render
const activeColumns = COLUMNS.filter(c => c.alwaysVisible || visibleColumns.has(c.id));
const colSpan = activeColumns.length + (showCheckboxes ? 1 : 0);
```

Replace all hardcoded `colSpan` values (`showCheckboxes ? 6 : 5`) with the computed `colSpan`.

### Step 3: Refactor table header to use column config
**File**: `packages/web/src/pages/Leads.tsx` (lines 1339-1367)

Replace the hardcoded 5-column header array with:

```tsx
<thead>
  <tr className="bg-gray-50/80 border-b border-gray-200">
    {showCheckboxes && (
      <th className="pl-3 pr-1 py-2.5 w-8">
        <input type="checkbox" checked={...} onChange={toggleSelectAll} className="rounded border-gray-300 text-brand-600" />
      </th>
    )}
    {activeColumns.map(col => (
      <th key={col.id} className={`px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${col.width || ''}`}>
        {col.sortKey ? (
          <button onClick={() => toggleSort(col.sortKey!)} className="flex items-center gap-1 hover:text-gray-600 group">
            {col.label}
            {sort === col.sortKey ? (
              order === 'asc'
                ? <ChevronUp className="w-3 h-3 text-brand-500" />
                : <ChevronDown className="w-3 h-3 text-brand-500" />
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
            )}
          </button>
        ) : (
          <span>{col.label}</span>
        )}
      </th>
    ))}
  </tr>
</thead>
```

Import `ChevronUp` from lucide-react (already have `ChevronDown`).

### Step 4: Refactor table body to use column config with cell renderers
**File**: `packages/web/src/pages/Leads.tsx` (lines 1415-1522)

Replace the hardcoded 5-cell row with a loop over `activeColumns`:

```tsx
leads.map(lead => {
  const feedback = getFeedback(lead);
  const action = lead.composite_version === 2
    ? deriveActionState({ potential_score: lead.potential_score ?? 0, urgency_score: lead.urgency_score ?? 0, evidence_modifier: lead.evidence_modifier ?? 0.5 })
    : null;
  const actionCfg = action ? ACTION_CONFIG[action] : null;
  const rowTint = action === 'engage' ? 'bg-emerald-50/30' : action === 'pass' ? 'opacity-60' : '';

  return (
    <tr key={lead.id} className={`group hover:bg-gray-50 transition-colors ${selectedLeads.has(lead.id) ? 'bg-brand-50/30' : rowTint}`}>
      {showCheckboxes && (
        <td className="pl-3 pr-1 py-2.5" style={action ? { boxShadow: `inset 4px 0 0 0 ${actionColorMap[action]}` } : undefined}>
          <input type="checkbox" checked={selectedLeads.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded border-gray-300 text-brand-600" />
        </td>
      )}
      {activeColumns.map((col, i) => (
        <td
          key={col.id}
          className={`px-3 py-2.5 ${col.width || ''}`}
          style={i === 0 && !showCheckboxes && action ? { boxShadow: `inset 4px 0 0 0 ${actionColorMap[action]}` } : undefined}
        >
          {col.render(lead, { getFeedback: () => feedback, deriveAction: () => ({ action, cfg: actionCfg }), showCheckboxes })}
        </td>
      ))}
    </tr>
  );
})
```

Extract `actionColorMap` constant:
```typescript
const ACTION_COLOR_MAP: Record<string, string> = {
  engage: '#10b981', watch: '#f59e0b', research: '#38bdf8', pass: '#d1d5db',
};
```

Dimension column renderers should display:
- Numeric scores (0-100) with color-coded background using `dimColor()` pattern from ScoreBadge.tsx
- Data Confidence as `GradeBadge` from ScoreBadge.tsx
- Null values as `—` in gray

### Step 5: Column picker popover
**File**: `packages/web/src/pages/Leads.tsx`

Add a column picker button next to the existing filter toggle button (around line 1084). Follow the export picker dropdown pattern (lines 948-991):

```tsx
// New ref
const columnPickerRef = useRef<HTMLDivElement>(null);
const [showColumnPicker, setShowColumnPicker] = useState(false);

// Click-outside handler (same pattern as lines 572-589)

// Button (next to Filters button, around line 1100):
<div className="relative" ref={columnPickerRef}>
  <button
    onClick={() => setShowColumnPicker(!showColumnPicker)}
    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
  >
    <Columns3 className="w-3.5 h-3.5" />
    Columns
  </button>

  {showColumnPicker && (
    <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-2">
      <div className="px-3 py-1.5 mb-1 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">Visible Columns</span>
        <div className="flex items-center gap-2">
          <button onClick={showAllColumns} className="text-[10px] text-brand-600 hover:underline">All</button>
          <button onClick={resetColumns} className="text-[10px] text-gray-500 hover:underline">Reset</button>
        </div>
      </div>

      {/* Grouped: Core, Dimensions, Meta */}
      {['core', 'dimensions', 'meta'].map(group => (
        <div key={group}>
          <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-300">{group}</div>
          {COLUMNS.filter(c => c.group === group && !c.alwaysVisible).map(col => (
            <label key={col.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={visibleColumns.has(col.id)}
                onChange={() => toggleColumn(col.id)}
                className="rounded border-gray-300 text-brand-600"
              />
              {col.label}
            </label>
          ))}
        </div>
      ))}
    </div>
  )}
</div>
```

Import `Columns3` from lucide-react.

Helper functions:
```typescript
const toggleColumn = (id: string) => {
  setVisibleColumns(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
};

const showAllColumns = () => setVisibleColumns(new Set(COLUMNS.map(c => c.id)));
const resetColumns = () => setVisibleColumns(new Set(COLUMNS.filter(c => c.alwaysVisible || c.defaultVisible).map(c => c.id)));
```

### Step 6: Sortable column headers replacing dropdown
**File**: `packages/web/src/pages/Leads.tsx`

1. **Remove** the sort `<select>` dropdown (lines 1076-1082)
2. The header sort buttons from Step 3 now handle all sorting
3. Keep the existing `toggleSort()` function (line 653) and `sort`/`order` state unchanged — it already works with all backend sort keys
4. Remove `SORT_OPTIONS` array (line 115-126) since it's no longer needed
5. Update sort indicator: active column header shows `ChevronUp`/`ChevronDown` in brand color, inactive sortable headers show `ArrowUpDown` on hover

### Step 7: TypeScript check + visual verification
1. `cd packages/web && npx tsc --noEmit` — fix any type errors
2. `cd packages/server && npx tsc --noEmit` — should be unchanged
3. Start dev server (`npm run dev`) and verify:
   - Default view shows Company, Score, Campaign, Status, Updated columns
   - Column picker opens, shows grouped toggles
   - Enabling dimension columns adds them to the table
   - Clicking column headers sorts (with direction indicator)
   - Column preferences persist across page refresh (localStorage)
   - Bulk selection still works (colSpan adjusts dynamically)
   - "Select all matching" banner spans correct width
   - Loading/empty states span correct width

## Files Modified

| File | Steps | Change |
|------|-------|--------|
| `packages/web/src/pages/Leads.tsx` | 1-6 | Column config, visibility state, header/body refactor, picker, sort headers |

## Patterns to Reuse

- `dimColor()` from ScoreBadge.tsx for dimension score cell backgrounds
- `GradeBadge` from ScoreBadge.tsx for Data Confidence column
- Export picker dropdown pattern (Leads.tsx:948-991) for column picker
- Click-outside handler pattern (Leads.tsx:572-589)
- localStorage pattern (Leads.tsx:95, 142-150, 877-885) for column persistence
- `toggleSort()` function (Leads.tsx:653) — reuse as-is

## Backward Compatibility

- Default columns = exact same 5 as today — no visual change on first load
- `InlineScoreStrip` stays as the default "Score" column
- Dimension columns are opt-in — hidden by default
- Sort dropdown removed, but same sort behavior via headers
- All `colSpan` values become dynamic — handles any number of visible columns

## Anti-Patterns to Avoid

- Do NOT create a separate component file — keep column definitions in Leads.tsx to avoid prop-threading the complex filter/selection state
- Do NOT add drag-to-reorder — out of scope, adds complexity with no clear need
- Do NOT change the Lead interface or backend API — all data is already available
- Do NOT modify ScoreBadge.tsx — import and reuse existing components
