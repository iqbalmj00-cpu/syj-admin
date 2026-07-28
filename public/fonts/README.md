# Brand fonts — Inter

`src/lib/content-generator.tsx` (`loadFonts()`) and the shared compositor
`src/lib/content/compose.tsx` read these four static weights by exact filename.
Before they existed, every per-file read failed silently (`.catch(() => null)`)
and Satori fell back to a default face, so generated graphics did not render in
the brand typeface.

## Files

| File | Weight | SHA-256 |
|---|---|---|
| `Inter-Regular.ttf` | 400 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| `Inter-Medium.ttf` | 500 | `97ad806f526e41546d46365bb3a393145f75b7b1568913db74549ad8b8dba872` |
| `Inter-Bold.ttf` | 700 | `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` |
| `Inter-ExtraBold.ttf` | 800 | `e6756ad5690b77606aa62249a7b420d9902d45cae4b0048a24911fd4324b0a22` |
| `OFL.txt` | — | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |

## Source

Inter 4.1, official release archive
`https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`
(archive SHA-256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`).
The four files above are copied unmodified from `extras/ttf/` inside that
archive; `OFL.txt` is its `LICENSE.txt`, unmodified.

## Licence

SIL Open Font License 1.1 — full text in `OFL.txt`. Copyright (c) 2016 The Inter
Project Authors. Redistribution of the font files with this licence text is
permitted; the fonts are not sold on their own and are not renamed.

## Behavioural note

Adding these files deliberately changes how the existing `content_generator`
product graphics render — from a fallback face to Inter. That change was
accepted before the fonts landed. The product-generator pixel baseline used for
the compositor-extraction regression is therefore captured *after* this
directory exists, so the extraction check measures extraction only.
