# Release QA Checklist

- [ ] Titles render correctly on all user-facing views
- [ ] Meta tags include up-to-date release details
- [ ] Color contrast meets AA for key UI elements
- [ ] Focus states are visible and follow logical order
- [ ] Keyboard-only navigation covers critical flows
- [ ] Skip-links are present and functional
- [ ] Open Graph tags populate with accurate content
- [ ] Public release route is reachable without auth
- [ ] Skip link jumps directly to #main on Present Mode and public release views
- [ ] `npm run lh:present` logs scores (a11y ≥ 90) for Present Mode and Public Release
