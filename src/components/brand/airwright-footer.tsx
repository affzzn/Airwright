import { AIRWRIGHT } from "@/lib/brand";

/**
 * The branded quotation footer band — the company address line + contact details +
 * the accreditation logos (NASC / Constructionline / CHAS / SafeContractor), as on
 * the real Airwright quote. Accreditations render as clean badges (swap in the real
 * logo images later). Used only on the printable quotation.
 */
export function AirwrightFooter() {
  const { navy } = AIRWRIGHT.color;
  return (
    <div style={{ textAlign: "center", color: "#555" }}>
      <p style={{ margin: 0, fontSize: 11 }}>{AIRWRIGHT.addressInline}</p>
      <p style={{ margin: "2px 0 0", fontSize: 11 }}>
        Tel : {AIRWRIGHT.tel} &nbsp;&nbsp; Email : {AIRWRIGHT.email} &nbsp;&nbsp; Web : {AIRWRIGHT.web}
      </p>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {AIRWRIGHT.accreditations.map((a) => (
          <span
            key={a}
            style={{
              border: `1px solid ${navy}`,
              borderRadius: 4,
              padding: "3px 8px",
              fontSize: 9,
              fontWeight: 600,
              color: navy,
              letterSpacing: "0.02em",
            }}
          >
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}
