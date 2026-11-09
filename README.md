# Avalon Companion

A mobile-first, cross-device companion for in-person The Resistance: Avalon. The app never stores character roles. Team approval votes are attributable and revealed together; quest-card choices are anonymous.

## Current implementation

- Supabase-backed room creation and joining with opaque per-player session tokens (only token hashes are stored).
- Cross-device state synchronization through safe polling of a server-authorized RPC.
- Server-side validation of leader turns, team size, player membership, phases, duplicate votes, and quest-card eligibility.
- Team votes are stored by player and only exposed after everyone votes.
- Quest choices are not stored. The backend stores aggregate counts privately until all authorized team members submit, plus separate participation receipts that contain no ballot choice or timestamp.
- Physical role cards remain the source of truth. The app cannot enforce role-specific Success/Fail restrictions.

This is an initial deployable implementation. It still needs a live Supabase SQL run and a production build/test cycle before you use it for an actual game. Do not assume the app is live merely because the project URL and publishable key are configured.

## 1. Supabase setup

1. Open your Supabase project and go to **SQL Editor**.
2. Create a new query, paste the entire contents of `supabase/production.sql`, and run it.
3. Confirm the query completes successfully. The script creates the RPC functions and locks down direct table access with RLS.
4. In **Project Settings → API**, copy the Project URL and publishable key.

Do not put the database password, `service_role` key, or secret key in this project or in a browser environment variable.

## 2. Configure locally

The `.env.local` file in this working copy has been prefilled with the Project URL and publishable key supplied by the project owner. If you clone the project elsewhere, create `.env.local` using `.env.example`.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use Chrome or Edge for browser speech recognition; typed names are also supported. Every player should join on their own phone using the room code.

## 3. Deploy

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel's environment variables.
4. Deploy and test with at least five separate browser sessions before hosting a real game.

## Privacy and security model

- No character roles or role assignments are collected.
- Session tokens are random, stored in the browser, and stored hashed in the database.
- Direct table access is revoked; clients call narrowly scoped Postgres RPC functions.
- Team approval choices are persisted by player, but only become part of public state after all players vote.
- Quest ballot choices are discarded by the RPC. Only private aggregate counters and separate player participation receipts are maintained until the quest resolves. No individual quest ballot value or per-ballot timestamp is written.
- Quest progress polling returns only a submission count; it does not reveal partial Success/Fail totals.
- No raw audio or voiceprints are collected.
- The app does not know roles, so it cannot prevent a Good player from choosing Fail.
- For privacy, individual phones are strongly preferred over a shared pass-and-play phone.

## Rules currently enforced server-side

- 5–10 players and the standard quest team sizes.
- Majority approval for a team.
- Five consecutive rejected proposals end the game for Evil.
- Quest 4 requires two Fail cards with 7+ players.
- Three successful quests or three failed quests end the quest track; otherwise the game ends after Quest 5.

The Assassin endgame / role-specific special powers are not administered by the app because roles are intentionally not stored.
