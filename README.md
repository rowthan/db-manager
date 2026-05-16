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
4. Add `DB_MANAGER_PASSWORD` and `DB_MANAGER_SESSION_SECRET` to enable login protection.
5. Optionally set `DB_MANAGER_SESSION_TTL_SECONDS` to control session duration.
6. Optionally set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_R2_PUBLIC_BASE_URL` to enable Cloudflare export publishing.
7. Deploy.

The MongoDB connection string is intentionally not committed to the repository.
The login password is also kept in environment variables and is never committed.

## Run

1. Copy `.env.example` to `.env.local`
2. Set `MONGODB_URI`
3. Optionally set `MONGODB_DB`
4. Set `DB_MANAGER_PASSWORD`
5. Set `DB_MANAGER_SESSION_SECRET`
6. Optionally set `DB_MANAGER_SESSION_TTL_SECONDS`
7. Optionally set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_R2_PUBLIC_BASE_URL`
8. Run `npm run dev`

## Features

- Query MongoDB collections
- Save collection-level field and query presets
- Edit and delete documents
- Persist selected database and collection in localStorage
- Export query results and publish the exported JSON to Cloudflare R2
