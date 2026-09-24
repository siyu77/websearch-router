// Conventional Commits enforcement for PR titles & commit messages.
// Runs as a CI status check (see .github/workflows/ci.yml), not a pre-commit hook,
// so contributors get clear failure feedback without local friction.
//
// Mirrors the repo's permissive style — the default rules only require a valid
// `<type>(scope)?: <subject>` shape, not pedantic formatting.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // extensible scope list; keep in sync with CODEOWNERS / package layout if added
    'scope-enum': [0],
  },
};