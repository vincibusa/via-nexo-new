# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development**: `npm run dev` - Start development server with Turbopack
- **Build**: `npm run build` - Build application with Turbopack
- **Start**: `npm start` - Start production server
- **Lint**: `npm run lint` - Run ESLint

## Architecture Overview

This is a Next.js 15 admin dashboard for "Nexo", a venue and event management system with AI-powered recommendation features.

### Tech Stack
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS with Radix UI components
- **Database**: Supabase (PostgreSQL with pgvector for embeddings)
- **AI**: OpenAI GPT models via Vercel AI SDK
- **Authentication**: Supabase Auth with role-based access control

### Role-Based Access Control
Three user roles with hierarchical permissions:
- **User** (level 1): Basic access
- **Manager** (level 2): Can manage their own venues and events
- **Admin** (level 3): Full system access

### Key Architectural Components

#### AI-Powered Recommendation System
The core feature is a sophisticated RAG (Retrieval-Augmented Generation) pipeline located in `src/lib/ai/rag-pipeline.ts`:

1. **Geo Filtering**: Uses PostGIS to find venues within radius
2. **Semantic Search**: Converts user context to embeddings via OpenAI
3. **Vector Search**: pgvector cosine similarity matching
4. **Re-ranking**: Business logic scoring (verification status, distance, popularity)
5. **LLM Generation**: GPT-5-mini generates final suggestions with reasoning

#### Route Structure
- `/admin/*` - Admin-only routes with `ProtectedRoute` wrapper
- `/manager/*` - Manager routes with server-side role checking
- `/api/admin/*` - Admin API endpoints
- `/api/manager/*` - Manager API endpoints
- `/api/auth/*` - Authentication endpoints
- `/api/suggest/*` - AI recommendation endpoints

#### Data Layer
- **Supabase Client**: Browser client in `src/lib/supabase/client.ts`
- **Supabase Server**: Server client in `src/lib/supabase/server.ts`
- **Middleware**: Session management in `src/lib/supabase/middleware.ts`

#### Component Architecture
- **UI Components**: Radix-based components in `src/components/ui/`
- **Layout Components**: `AdminSidebar`, `Navbar`, role-specific layouts
- **Protection**: `ProtectedRoute` component handles client-side role checking
- **Hooks**: `useAuth` and `useUser` for authentication state

### Important Implementation Details

#### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- OpenAI API keys for AI features

#### Path Aliases
- `@/*` maps to `src/*`

#### Database Dependencies
- Requires custom Supabase RPC functions: `places_within_radius`, `match_place_embeddings`
- Uses pgvector extension for embedding storage and similarity search

#### AI Pipeline Context
The `SuggestionContext` interface in rag-pipeline.ts defines user preferences:
- Companionship, mood, budget, time preferences
- Location coordinates and search radius
- Custom preferences array

This system processes venue recommendations through multiple stages of filtering and AI enhancement to provide contextually relevant suggestions.