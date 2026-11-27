# Getting started with Bob: the customer guide

| File | What it is |
|---|---|
| `Getting-started-with-Bob.pdf` | The designed guide to give customers (A4, contents, page numbers). |
| `Getting-started-with-Bob.docx` | An editable Word version of the same guide. |
| `content.cjs` | **The words of the guide.** Edit this, then rebuild. |
| `images/` | Screenshots from the fictional Ridgeway demo workspace, with numbered markers. |
| `capture.cjs` | Retakes the screenshots from a running copy of Bob. |
| `build.cjs` | Builds the PDF, the Word file and the HTML page from `content.cjs`. |

Customers open the guide in Bob from **Help & user guide** (account menu), **More → Help** on a phone, or **Settings → Help & support**. These all link to `public/guide/getting-started-with-bob.pdf`, which `build.cjs` updates.

## Updating the guide

1. Edit `content.cjs`. Each chapter is a list of blocks: paragraphs, numbered steps, bullets, screenshots, tips, "needs a connection" notes and things to say to Bob.
2. If screens have changed, start Bob locally (`npm run dev`) and run:

   ```bash
   BASE=http://localhost:3000 node docs/manual/capture.cjs
   ```

3. Rebuild:

   ```bash
   node docs/manual/build.cjs
   ```

4. Raise `version` and `published` at the top of `content.cjs`.

For small wording changes, you can also edit the Word file directly. Next time the guide is rebuilt, copy those changes into `content.cjs` so the PDF and the Word file stay the same.
