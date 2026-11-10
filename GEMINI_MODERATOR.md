# Gemini moderator integration

This is an opt-in server-side enhancement to the existing browser speech recognition and local name parser.

## Setup
1. Create a Gemini API key in Google AI Studio: https://aistudio.google.com/apikey
2. In the Vercel project serving the live site, open Settings → Environment Variables. Add **GEMINI_API_KEY** as a **server-only** variable. Do not prefix it with NEXT_PUBLIC_.
3. Redeploy the latest commit from main once merged. If the variable is absent, the existing local parser still works.

## Behavior
- The browser listens only when the host or leader taps the microphone button.
- Short rolling transcript snippets, player names and player IDs are sent to the server, then to Google Gemini.
- Gemini returns a proposed team of player IDs, validated against the roster and quest size.
- The host/leader must review/edit and confirm; no AI output can submit a vote or quest card.
- No roles, secret votes, or audio recordings are sent to Gemini.
- API errors, unavailable quota, and missing key leave the existing local parser available.
- A basic per-IP rate limiter reduces accidental abuse; it is not distributed or a substitute for authentication/production abuse controls.

## Test
1. Start a five-player room and enter nomination phase.
2. Enable the microphone and say "Send Alex and Ben. Actually swap Ben for Casey."
3. Check the suggested team is Alex + Casey, edit if needed, and confirm.
4. Remove GEMINI_API_KEY temporarily in a test deployment to verify the local fallback.
5. Test rate-limit behavior and confirm no hidden-role or quest-ballot data reaches the endpoint.

Google free-tier availability, quotas and data use vary by model, region and account. Check Google's current terms before inviting players.
