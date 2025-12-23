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

## Current Status (WIP)

### Known Issue: PAO Search Not Returning Results
The Manatee County PAO search form at `manateepao.gov/search/` is complex:
- Dynamic JavaScript-generated form
- Multiple search strategies implemented (Firecrawl form fill, Exa AI fallback)
- Form fields discovered via browser inspection: `#OwnLast`, `#OwnFirst`, `#ParcelId`, `#Address`, `#Zip`
- Submit button: `input[type="submit"].btn-success`

### Recent Fixes (not yet working)
1. **URL validation** - Only accepts URLs with parcel ID parameters (e.g., `parid=1234567890`)
2. **Address validation** - Prevents LLM hallucination by verifying extracted address matches search
3. **Correct form selectors** - Updated to use actual DOM element IDs from browser inspection

### Potential Next Steps
1. Try direct API approach if PAO has a backend endpoint
2. Consider using Playwright directly for more reliable browser automation
3. Alternative data sources (Zillow API, public records APIs)

## Environment Variables Required
```
FIRECRAWL_API_KEY=
EXA_API_KEY=
DATABASE_URL=
BETTER_AUTH_SECRET=
```

## Commands
```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # Run linter
```
