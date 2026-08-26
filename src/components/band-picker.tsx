"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProjectRateBand } from "@/server/actions/projects";

const BANDS = [
  { value: "SUPER_COMPETITIVE", label: "Super competitive" },
  { value: "COMPETITIVE", label: "Competitive" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CUSTOM", label: "Custom" },
];

/**
 * The rate-band ("rate bucket") picker for a project's pricing. Choosing a band
 * saves it on the project and re-prices the matrix (router.refresh). The £ rates
 * behind each band are edited on /rates — this only chooses which band applies.
 */
export function BandPicker({
  projectId,
  value,
}: {
  projectId: string;
  value: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onChange = (band: string) =>
    start(async () => {
      await setProjectRateBand(projectId, band);
      router.refresh();
    });

  return (
    <select
      aria-label="Rate bucket"
      value={value}
      disabled={pending}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none disabled:opacity-50"
    >
      {BANDS.map((b) => (
        <option key={b.value} value={b.value}>
          {b.label}
        </option>
      ))}
    </select>
  );
}
