# Carried Across: how ideas travel

The book of the atlas. Nine chapters and a preface on the mechanics of how ideas
move, built from the same dataset as the site: the carriers, the patrons, the
bridge communities, the productive errors, and the absence of any plan.

## Where things live

- `manuscript/` holds the chapters as plain markdown, one file per chapter.
  The manifest (order, slugs, titles) is `src/lib/book.ts`.
- The site renders the reading edition at `/book/` and `/book/<chapter>/`.
- `/book/print/` is the typeset print edition. Its appendices (all fourteen
  chains, the method note, the bibliography) are generated from `data/` at
  build time, so the book cannot drift from the atlas.

## Making the PDF

```sh
pnpm build
pnpm book:pdf      # writes book/carried-across.pdf via headless Chrome
```

Or open `/book/print/` in a browser and print to PDF (margins: none,
background graphics: on). The PDF is not committed; the pipeline is the artifact.

## Editing

Edit the markdown, keep the house style (no em dashes, sentence-case headings,
straight quotes, plain English), and remember the standing rule of the project:
factual claims about transmission belong in `data/` with sources, and the prose
should not assert what the dataset does not support. Section breaks are `***`.
