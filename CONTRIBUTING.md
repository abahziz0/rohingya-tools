# Contributing to Rohingya Tools

Contributions to Hanifi Rohingya script conversion and Rohingya Reader are
welcome. Open an issue first for a substantial behavior or architecture change.

## Development

Use Node.js 24.15 or newer. From the repository root:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

The shared engine is `converter/transliterate.ts`. The extension imports it
directly, so improvements apply to both tools. Keep runtime conversion offline.

## Report a conversion issue

Include the original text, expected output, actual output, conversion direction,
warnings, and the spelling convention you are using. A minimal example is more
useful than a full document. Explain how the expected spelling was verified and
credit its source. Do not submit private page content or personal information.

Read `converter/transliteration-examples.md` before proposing mapping changes.
Reviewed examples should support linguistic changes. Refresh engine snapshots
only for intended changes: `npm run examples:snapshot --workspace extension`.

## Report an extension issue

Include browser and extension versions, operating system, steps to reproduce,
and a minimal public test page if possible. Describe whether automatic
conversion, dynamic content, or right-to-left layout is involved.

## Pull requests

Keep changes focused, explain the resulting behavior, and include relevant test
results. Update documentation when behavior changes. Preserve font license
notices and avoid adding unnecessary permissions or network requests.

Contributions are provided under the project's MIT license. Third-party assets
must include their compatible license and attribution. Report security issues
privately as described in `SECURITY.md`.
