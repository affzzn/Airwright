/**
 * Airwright Midland brand details for the client-facing quotation PDF (the print
 * view). Read off the company's real quote template (Quote 1315). Used ONLY on the
 * printable quote — the rest of the app stays strictly monochrome (docs/07).
 */
export const AIRWRIGHT = {
  legalName: "Airwright Midland Limited",
  name: "Airwright Midland",
  tagline: "Your trusted scaffolding partner.",
  addressLines: ["Unit 3B", "Crossgate Road", "Park Farm Industrial Estate", "Redditch", "B98 7SN"],
  addressInline:
    "Airwright Midland Limited  Unit 3B  Crossgate Road  Park Farm Industrial Estate  Redditch  B98 7SN",
  tel: "01527 523999",
  email: "enquiries@airwrightmidland.co.uk",
  web: "www.airwrightmidland.co.uk",
  accreditations: [
    "NASC — National Access & Scaffolding Confederation",
    "Constructionline",
    "CHAS Accredited Contractor",
    "SafeContractor Approved",
  ],
  /** Brand palette (used ONLY in the printable quotation). */
  color: {
    navy: "#16265d",
    blue: "#4b8fd0",
    sky: "#8fbce6",
    tagline: "#5f9bd6",
  },
} as const;
