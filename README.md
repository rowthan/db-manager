# db-manager

Standalone Next.js 16 app for MongoDB browsing and editing.

## Structure

- App Router at `app/`
- API route handlers at `app/api/db/*`
- MongoDB connection code at `service/server/mongodb.ts`

## Deploy to Vercel

1. Import this repository into Vercel as a Next.js project.
2. Add `MONGODB_URI` in the Vercel project environment variables.
3. Optionally add `MONGODB_DB` if you want a default database.
4. Deploy.

The MongoDB connection string is intentionally not committed to the repository.

## Run

1. Copy `.env.example` to `.env.local`
2. Set `MONGODB_URI`
3. Optionally set `MONGODB_DB`
4. Run `npm run dev`

## Features

- Query MongoDB collections
- Save collection-level field and query presets
- Edit and delete documents
- Persist selected database and collection in localStorage
