# PropertyMatch v2 UI Implementation Plan

## Current State Analysis

### Issues Identified
1. **No Dark Mode Support**: Components use hardcoded light-mode colors (e.g., `bg-white`, `text-gray-900`)
2. **Limited Lead Display**: Simple text cards without photos or visual hierarchy
3. **Missing Match Criteria**: No display of why leads were matched
4. **No Photo Integration**: `PersonSearchResult` interface lacks image field
5. **Basic Typography**: Geist fonts exist but not leveraged for visual hierarchy

---

## Implementation Plan

### Phase 1: Design Token System & Theme Infrastructure

**Files to modify:**
- `src/app/globals.css` - Add comprehensive CSS variables
- `tailwind.config.ts` - Extend theme with semantic tokens
- `src/app/layout.tsx` - Add theme provider and toggle

**Changes:**
1. Create semantic color tokens for both light/dark modes:
   - `--background`, `--foreground`
   - `--card`, `--card-foreground`
   - `--primary`, `--primary-foreground`
   - `--muted`, `--muted-foreground`
   - `--accent`, `--accent-foreground`
   - `--border`, `--ring`

2. Add ThemeProvider component using `next-themes` package
3. Create ThemeToggle component for header

---

### Phase 2: Enhanced Exa Integration for Photos

**Files to modify:**
- `src/lib/exa.ts` - Update interface and API calls

**Changes:**
1. Update `PersonSearchResult` interface:
```typescript
export interface PersonSearchResult {
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  summary?: string;
  highlights?: string[];
  imageUrl?: string;        // NEW: Profile photo
  matchScore?: number;       // NEW: Relevance score
  matchCriteria?: string[];  // NEW: Why they matched
}
```

2. Update Exa API call to request image data when available
3. Add fallback avatar generation (initials-based or DiceBear API)

---

### Phase 3: UI Component Library Upgrade

**Files to modify:**
- `src/components/ui/card.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- Create `src/components/ui/avatar.tsx`
- Create `src/components/ui/badge.tsx`
- Create `src/components/ui/skeleton.tsx`

**Changes:**
1. Update all components to use CSS variable-based colors
2. Add Avatar component with image fallback
3. Add Badge component for match criteria tags
4. Add Skeleton component for loading states
5. Improve focus states and transitions

---

### Phase 4: Lead Card Redesign

**Files to create/modify:**
- `src/components/search/lead-card.tsx` (NEW)
- `src/components/search/research-results.tsx`

**New Lead Card Design:**
```
+------------------------------------------+
|  [Avatar]  Name                    Score |
|            Title @ Company               |
|            Location                      |
+------------------------------------------+
|  Match Criteria:                         |
|  [Badge] [Badge] [Badge]                 |
+------------------------------------------+
|  Summary excerpt...                      |
+------------------------------------------+
|  [LinkedIn]  [Save]  [Contact]           |
+------------------------------------------+
```

**Features:**
- Large avatar with gradient fallback
- Match score indicator (circular progress or badge)
- Match criteria as colored badges
- Expandable summary section
- Quick action buttons with icons
- Hover/focus states with subtle animations

---

### Phase 5: Dashboard & Layout Polish

**Files to modify:**
- `src/app/(protected)/dashboard/page.tsx`
- `src/components/layout/header.tsx`
- `src/components/auth/auth-form.tsx`
- `src/app/page.tsx`

**Changes:**
1. Update header with theme toggle and improved nav
2. Add subtle background patterns/gradients
3. Improve spacing with consistent scale (4, 8, 12, 16, 24, 32, 48, 64)
4. Add page transitions
5. Improve form styling with floating labels

---

### Phase 6: Results Page Enhancement

**Files to modify:**
- `src/components/search/research-results.tsx`

**Changes:**
1. Add grid/list view toggle
2. Implement virtual scrolling for large result sets
3. Add filtering by match criteria
4. Add sorting options (score, name, location)
5. Add bulk actions (save multiple, export)

---

## Dependencies to Install

```bash
npm install next-themes lucide-react @radix-ui/react-avatar @radix-ui/react-slot class-variance-authority clsx tailwind-merge
```

---

## Color Palette

### Light Mode
- Background: `#FAFAFA`
- Card: `#FFFFFF`
- Primary: `#2563EB` (Blue 600)
- Accent: `#8B5CF6` (Violet 500)
- Success: `#10B981` (Emerald 500)
- Text: `#0F172A` (Slate 900)
- Muted: `#64748B` (Slate 500)

### Dark Mode
- Background: `#0F172A` (Slate 900)
- Card: `#1E293B` (Slate 800)
- Primary: `#3B82F6` (Blue 500)
- Accent: `#A78BFA` (Violet 400)
- Success: `#34D399` (Emerald 400)
- Text: `#F8FAFC` (Slate 50)
- Muted: `#94A3B8` (Slate 400)

---

## Typography Scale

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 | 2.25rem (36px) | 700 | 1.2 |
| H2 | 1.875rem (30px) | 600 | 1.25 |
| H3 | 1.5rem (24px) | 600 | 1.3 |
| H4 | 1.25rem (20px) | 600 | 1.4 |
| Body | 1rem (16px) | 400 | 1.5 |
| Small | 0.875rem (14px) | 400 | 1.5 |
| Caption | 0.75rem (12px) | 500 | 1.4 |

---

## Estimated Implementation Order

1. Install dependencies
2. Set up theme infrastructure (globals.css, tailwind.config, ThemeProvider)
3. Create new UI primitives (Avatar, Badge, Skeleton)
4. Update existing components for dark mode
5. Create LeadCard component
6. Update research-results.tsx to use new components
7. Update Exa integration for photos/criteria
8. Polish header, dashboard, and forms
9. Add animations and transitions
10. Test across light/dark modes

---

## Success Criteria

- [ ] Seamless light/dark mode toggle
- [ ] Lead cards display photos (real or fallback)
- [ ] Match criteria visible as badges on each lead
- [ ] Consistent spacing and typography throughout
- [ ] Smooth transitions and hover states
- [ ] Accessible color contrast (WCAG AA)
- [ ] Responsive on mobile, tablet, desktop
