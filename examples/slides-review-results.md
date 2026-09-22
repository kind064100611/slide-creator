# Slide fidelity review results

Date: 2026-09-21

Review status: **withdrawn / not fully reviewed**.

The previous 19 prose-only `Pass` rows were not derived from a direct comparison of the current reference and candidate HTML files. They therefore never qualified and have been withdrawn rather than grandfathered.

No deck or page currently has a valid Pass in this file. A replacement result must be produced by running the direct artifact comparison against the current files:

```powershell
node scripts/validate_review_records.cjs <reference.html> <candidate.html>
```

The validator derives evidence from both HTML artifacts and writes JSON to stdout. Do not create hand-written review manifests, generation records, or verdict declarations in `examples/`.

CoreTradingCapacity must be re-reviewed first because its generated pages declared valid layout names without instantiating the canonical template DOM/CSS, and several pages materially regressed in typography scale, leaf-content density, paragraph/list grouping, or emphasis. The remaining cases must then be reviewed under the same direct-comparison contract.
