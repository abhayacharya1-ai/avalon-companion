# Voice moderator upgrade

This branch adds an **opt-in browser speech-recognition assistant** for detecting a possible quest team. It is not an always-on background audio agent, does not perform speaker identification, and does not record audio in Supabase.

## Deploy safely

1. In Supabase SQL Editor, run `supabase/voice_moderator_migration.sql` **after** the existing `production.sql` schema. This updates the nomination RPC so the room creator can confirm a team on behalf of the current leader. The recorded leader remains the actual rotating game leader.
2. Confirm GitHub Actions / Vercel builds successfully. Test a 5-player game on separate devices before merging.
3. Merge pull request #1 into `main`. If Vercel is connected to the repository, it should deploy automatically. Check its deployment status.
4. On the host's phone, allow microphone access and press **Start listening** during the nomination phase. Verify a suggestion appears after a spoken nomination; edit names and confirm. Only after confirmation does team voting start.
5. Test rejected proposals, 5 consecutive rejections, approved quest-team-only ballot access, and anonymous quest result aggregation.

## Browser limitations

Browser speech recognition may not work on every phone/browser. The host must keep the page active and phone awake; background listening on locked iPhones is not reliable. Browser speech services may process microphone audio remotely. Obtain consent from everyone at the table before enabling listening.

## Current limitations

- Name matching uses exact normalized player names and simple nomination phrases; it is not an LLM, speaker diarization, or trained model.
- Correction feedback is not yet stored or used to train a model.
- The app does not automatically push notifications; the host sees an in-page suggestion.
- Join links prefill the room code but still require players to enter their name.
- Manual team selection is always available.
