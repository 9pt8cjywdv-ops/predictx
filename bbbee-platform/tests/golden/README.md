# Golden verification cases

Every release runs `npm test`; each JSON file in `cases/` is a complete scorecard
input (versioned configuration + verified inputs) and its **manually established**
expected result. Any unexplained difference fails the build (spec §52).

## Case provenance

`provenance.kind` must be one of:

| kind | meaning |
|------|---------|
| `ENGINE_FIXTURE` | Synthetic numbers that exercise engine mechanics only. **Not regulatory.** |
| `AUTHORITATIVE`  | An anonymised real verification whose result was established by a qualified verification professional against the cited Code version. |

`AUTHORITATIVE` cases must include `establishedBy`, `establishedOn`, `regulatoryVersionLabel`
and `sourceReference`, and must use rule parameters captured from the approved Regulatory Library.

## Required authoritative cases (outstanding — require client-supplied files)

Generic QSE · Generic Large Enterprise · 51% black-owned QSE · 100% black-owned EME ·
Construction · ICT · Financial Sector · complex ownership · trust ownership ·
large procurement file · failed priority element.

These cannot be authored until authoritative Code documents and anonymised verification
files with signed-off results are supplied.
