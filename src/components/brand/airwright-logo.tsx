import { AIRWRIGHT } from "@/lib/brand";

/**
 * The Airwright Midland wordmark, recreated in SVG/CSS so the branded quotation PDF
 * needs no external image asset. Navy "Airwright" + a two-tone triangle scaffold
 * mark + blue "Midland", with the tagline underneath — matching the company's real
 * quote letterhead. Swap in the real logo image later if preferred.
 */
export function AirwrightLogo({ width = 220 }: { width?: number }) {
  const { navy, blue, sky, tagline } = AIRWRIGHT.color;
  return (
    <div style={{ width, lineHeight: 1 }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: width * 0.19,
          letterSpacing: "-0.02em",
          color: navy,
        }}
      >
        Airwright
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: width * 0.03, marginTop: width * 0.01 }}>
        <svg width={width * 0.2} height={width * 0.16} viewBox="0 0 46 36" aria-hidden>
          <polygon points="0,36 8,20 16,36" fill={navy} />
          <polygon points="11,36 23,10 35,36" fill={blue} />
          <polygon points="30,36 38,20 46,36" fill={sky} />
        </svg>
        <div style={{ fontWeight: 700, fontSize: width * 0.19, letterSpacing: "-0.02em", color: navy }}>
          Midland
        </div>
      </div>
      <div
        style={{
          marginTop: width * 0.02,
          fontStyle: "italic",
          fontSize: width * 0.058,
          color: tagline,
        }}
      >
        {AIRWRIGHT.tagline}
      </div>
    </div>
  );
}
