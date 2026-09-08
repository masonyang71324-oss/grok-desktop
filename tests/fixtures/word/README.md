# Word fixtures

`sample.doc` and `sample.docx` are the upstream `test15` fixtures from
[node-word-extractor](https://github.com/morungos/node-word-extractor), commit
`d971d9f69056245ae129bd2ce31436d518293854`, under `__tests__/data/`.
They exercise body text and headers/footers. The upstream MIT license is included.
These public fixtures contain no user documents.

The other DOCX files are generated test documents: Chinese punctuation and a
two-cell table; an empty document; and repeated ASCII text below/above the
extraction limits; long Chinese across XML read boundaries; and modern textboxes
with and without alternate fallback markup. Their contents were created for these tests.
