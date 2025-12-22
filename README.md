# PropertyMatch - Real Estate Demographic Research Agent

AI-powered property research platform that matches potential buyers to properties using demographic data analysis via Exa's people search API.

## Features

- **Property Research**: Lookup property details from Manatee County PAO (with planned Zillow/Realtor.com integration)
- **Demographic Insights**: AI-powered analysis of area demographics, income levels, and lifestyle indicators
- **Buyer Matching**: Identify ideal buyer personas and find real potential buyers
- **Authentication**: Google OAuth and email/password authentication via Better-Auth
- **Search History**: Save and review past property research

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: Neon Postgres with Drizzle ORM
- **Authentication**: Better-Auth
- **AI/Search**: Exa API for demographic research and people search
- **Styling**: Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+
- A Neon database (https://neon.tech)
- Exa API key (https://exa.ai)
- Google OAuth credentials (for Google sign-in)

### Installation

1. Clone the repository:
```bash
git clone <repo-url>
cd real-estate-agent
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment example and configure:
```bash
cp .env.example .env
```

4. Configure your `.env` file:
```env
# Database
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Authentication
BETTER_AUTH_SECRET=<generate-a-secret-key>
BETTER_AUTH_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>

# Exa API
EXA_API_KEY=<your-exa-api-key>

# Anthropic API (optional, for future Claude Agent SDK features)
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

5. Push the database schema:
```bash
npm run db:push
```

6. Start the development server:
```bash
npm run dev
```

7. Open http://localhost:3000

## Database Commands

```bash
npm run db:generate  # Generate migrations
npm run db:migrate   # Run migrations
npm run db:push      # Push schema to database (dev)
npm run db:studio    # Open Drizzle Studio
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── auth/          # Better-Auth handler
│   │   └── research/      # Property research endpoint
│   ├── auth/              # Authentication page
│   ├── dashboard/         # Main dashboard
│   └── history/           # Search history
├── components/            # React components
│   ├── auth/              # Auth-related components
│   ├── layout/            # Layout components
│   ├── search/            # Search & results components
│   └── ui/                # Reusable UI components
├── db/                    # Database schema & connection
├── lib/                   # Core libraries
│   ├── agent.ts           # Research agent orchestration
│   ├── auth.ts            # Better-Auth server config
│   ├── auth-client.ts     # Better-Auth client
│   ├── exa.ts             # Exa API integration
│   └── property-search.ts # Property data sources
```

## API Endpoints

### POST /api/research
Research a property by address. Requires authentication.

**Request:**
```json
{
  "address": "123 Main St, Bradenton, FL 34201"
}
```

**Response:**
```json
{
  "success": true,
  "searchId": 1,
  "result": {
    "property": { ... },
    "demographics": { ... },
    "potentialBuyers": [ ... ],
    "buyerPersonas": { ... },
    "summary": "...",
    "recommendations": [ ... ]
  }
}
```

### GET /api/research
Get search history. Requires authentication.

## Roadmap

- [ ] Zillow API integration
- [ ] Realtor.com API integration
- [ ] Enhanced Manatee PAO scraping (currently uses mock data)
- [ ] Claude Agent SDK for advanced property analysis
- [ ] Export research reports as PDF
- [ ] Team collaboration features
- [ ] Saved property alerts

## License

MIT
