# Poker Chips development

- Keep Firebase on Spark: no Cloud Functions, billing upgrade or payment method.
- Preserve existing room data and anonymous Firebase identities during updates.
- Every user-visible production release must have a higher semantic version in `package.json`, `package-lock.json`, and `releases.json`. Use `npm run release:prepare -- 0.0.2 "Änderung"` with the next version and clear German release notes. Never reuse or move an existing release tag.
- Run unit tests, the Firebase emulator integration tests, and the Pages build before publishing. The Pages workflow creates a matching GitHub release only after deployment succeeds.
- Test timers at hand/turn boundaries, duplicate commands and reconnects. Never adjust a live user's room for testing.
