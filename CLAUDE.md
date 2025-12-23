# Real Estate Demographic Research Agent

## Project Overview
AI-powered real estate research application that searches property records and provides demographic insights for potential buyers.

## Tech Stack
- **Framework**: Next.js 16.1 (App Router, Turbopack)
- **Language**: TypeScript
- **UI**: React, Tailwind CSS, shadcn/ui components
- **Database**: Drizzle ORM (PostgreSQL)
- **Authentication**: Better Auth
- **AI/Search Services**:
  - **Firecrawl**: Web scraping with browser automation for form filling
  - **Exa AI**: Semantic search for finding indexed property pages
  - (Future) Claude Agent SDK for orchestration

## Key Features
- Property search via Manatee County Property Appraiser (PAO)
- Rich property details: valuations, building info, sales history
- Demographic insights and buyer persona research
- Dark mode UI with responsive design

## Architecture

### API Routes
- `/api/research` - Main research endpoint that orchestrates property lookup
- `/api/auth/[...all]` - Authentication routes

### Core Libraries
- `src/lib/property-search.ts` - Property search integration with PAO
- `src/lib/firecrawl.ts` - Firecrawl browser automation for form filling
- `src/lib/exa.ts` - Exa AI search for buyer research
- `src/lib/agent.ts` - Research orchestration

### Components
- `src/components/search/` - Property search form and results display

## Current Status

### Playwright-based PAO Search (December 2024)
The property search now uses **Playwright** instead of Firecrawl for more reliable browser automation:

**Architecture:**
- `src/lib/playwright/browser.ts` - Browser lifecycle manager (supports local Chromium for Docker/VPS)
- `src/lib/pao/manatee-pao.playwright.ts` - PAO-specific form filling and data extraction
- `src/lib/property-search.ts` - Orchestrates search with Exa AI fallback

**Key Features:**
- Deterministic HTML parsing with Cheerio (no LLM hallucination)
- Proper "no results" detection
- Address validation to prevent wrong property data
- Bot/CAPTCHA detection with clear error messages
- Configurable timeouts via environment variables

**PAO Detail Page Structure (discovered December 2024):**
The PAO detail page has a complex structure:

- **Owner Info**: Located in `.owner-content` on the MAIN PAGE (NOT in the iframe!)
  - The iframe (`skelOwnerContentIFrame`) is just a CSS skeleton placeholder
  - Owner data extracted via DOM-based Cheerio parsing

- **Two Tab Groups** (Bootstrap tabs):
  1. **Sales Card** (left): Sales (default) | Exemptions | Businesses | Addresses | Inspections
  2. **Values Card** (right): Values (default) | Land | Buildings | Features | Permits

- **Default Visible Tables**:
  - `#tableSales` - Sales history (visible by default)
  - `#tableValue` - Property valuations (visible by default)

- **Tab-Based Content** (requires clicking):
  - Inspections tab: `a[href="#inspections"]` in Sales card
  - Features tab: `a[href="#features"]` in Values card
  - Bootstrap tabs use `aria-controls` attribute to link to pane IDs

**Known Issues (WIP):**
- Iframe content extraction times out (skeleton placeholder, not real data)
- Inspections and Features tab panes not found after clicking tabs
- Tab pane IDs may differ from tab href (need to resolve via `aria-controls`)

**Form Fields (manateepao.gov/search/):**
- `#OwnLast`, `#OwnFirst` - Owner name fields (filled with wildcards `*`)
- `#ParcelId` - Parcel ID field (wildcard for address search)
- `#Address` - Main search field with typeahead
- `#Zip` - Optional zip code filter
- Submit: `input[type="submit"].btn-success`

### Setup for Docker/VPS Deployment
```bash
# Install dependencies
npm install

# Install Chromium browser for Playwright
npx playwright install chromium

# Run the app
npm run dev
```

## Environment Variables Required
```
DATABASE_URL=
BETTER_AUTH_SECRET=
EXA_API_KEY=

# Playwright (optional - leave empty for local Chromium)
PLAYWRIGHT_WS_ENDPOINT=
PAO_SCRAPE_TIMEOUT_MS=60000
PAO_NAV_TIMEOUT_MS=45000
```

## Commands
```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # Run linter
```
