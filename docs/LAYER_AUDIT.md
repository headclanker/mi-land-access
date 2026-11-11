# Layer overlap audit

Audit of every public-land layer against county parcel records, run 2026-11-11.

## Method

- 18 sample areas (about 5 × 8 miles each) in counties with owner-name parcels, each centred on known public land: Allegan, Antrim, Barry, Cheboygan, Gladwin, Houghton, Huron, Ingham, Ionia, Kent, Lenawee, Marquette, Montcalm, Newaygo, Roscommon, Schoolcraft, Shiawassee, Tuscola.
- 21,601 parcels. Each was graded by owner name, then intersected with every public-land layer. A layer "covers" a parcel when it overlaps at least half of it.
- Not sampled: any Hunting Access Program polygon, any non-USFS federal unit, and the 51 counties with no owner-name parcels.

## Findings

| Layer | What the overlap showed | Cause | Decision |
|---|---|---|---|
| State game & wildlife areas (`dnr-wildlife-areas`) | 263 private parcels fully inside a green or yellow fill | It is an administrative project boundary, not ownership | Outline and label only; never a grade |
| State park boundaries (`dnr-state-parks`) | Private lots and DNR land both under one yellow fill | Administrative boundary | Outline and label only |
| Commercial Forest (`commercial-forest`) | 79 parcels red by owner name under green | Both true: private land with a statutory public foot-access right | Parcel takes the Commercial Forest grade; owner still shown |
| DNR-managed lands (`dnr-managed-lands`) | 116 parcels yellow by owner name ("STATE OF MICHIGAN", "US GOVERNMENT") under green | Assessor names don't say which agency | DNR's layer decides for generic state/federal owners |
| DNR-managed lands | 31 private parcels fully covered, 170 partly covered | Recent sales, inholdings, boundary misalignment | Full cover: "records disagree" (yellow). Partial: grade unchanged, note added |
| National forest (`usfs-surface-ownership`) | 40 "U S GOVT" parcels yellow under green; no private parcel fully covered | Assessor names don't say Forest Service | Forest Service layer decides |
| State park hunting status (`dnr-park-hunting`) | 17 DNR-owned parcels green by owner name under closed or restricted zones | Owner name can't know park zoning | Park zone status overrides everything |
| DNR-managed lands, park rows | Third colour stacked on the park zones | Same land as the park hunting layer (307,217 vs 307,155 acres statewide) | Park rows dropped from this layer |
| PAD-US state / local / conservancy | 25 private parcels covered; DNR land labelled "non-DNR" | Coarse national dataset | Parcel record wins when it names an owner |

## Not conflicts

- 22 DNR-owned parcels showed no covering public layer. Spot checks were large parcels cut by the sample-area edge, not missing state land.
- Blank-owner parcels under public land (about 90) are county records with no name; the public layer decides.

## Known limits

- Reconciliation only happens where a county publishes parcels. Elsewhere the public-land layers stand alone.
- "Records disagree" parcels cannot be settled from data; they need the county register of deeds or DNR.
