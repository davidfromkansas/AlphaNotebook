# Alpha Notebook

Collect, extract, and organize web content into structured collections.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Styling**: Tailwind CSS v4
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Google OAuth (via NextAuth.js)
- **Content Extraction**: Exa API

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Google OAuth credentials
- Exa API key

### Setup

1. Clone the repo:

   ```bash
   git clone https://github.com/davidfromkansas/AlphaNotebook.git
   cd AlphaNotebook
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment file and fill in your values:

   ```bash
   cp .env.example .env
   ```

4. Generate the Prisma client:

   ```bash
   npx prisma generate
   ```

5. Run database migrations:

   ```bash
   npx prisma migrate dev
   ```

6. Start the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/          # Next.js App Router pages and layouts
├── components/   # Reusable UI components
├── lib/          # Shared utilities (prisma client, exa, etc.)
└── generated/    # Auto-generated Prisma client (gitignored)
prisma/
├── schema.prisma # Database schema
└── migrations/   # Database migrations
```

## Scripts

| Command         | Description             |
| --------------- | ----------------------- |
| `npm run dev`   | Start dev server        |
| `npm run build` | Production build        |
| `npm run start` | Start production server |
| `npm run lint`  | Run ESLint              |
