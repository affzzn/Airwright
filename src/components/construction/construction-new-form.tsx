"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { createConstructionQuote } from "@/server/actions/construction";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { BAND_LABEL, SITE_TYPE_LABEL, type RateBand, type SiteType } from "@/lib/construction/types";

const BAND_OPTS = (Object.keys(BAND_LABEL) as RateBand[]).map((b) => ({ value: b, label: BAND_LABEL[b] }));
const SITE_OPTS = (Object.keys(SITE_TYPE_LABEL) as SiteType[]).map((s) => ({ value: s, label: SITE_TYPE_LABEL[s] }));

export function ConstructionNewForm() {
  const [reference, setReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [band, setBand] = useState("COMPETITIVE");
  const [durationWeeks, setDurationWeeks] = useState("");
  const [enquiryType, setEnquiryType] = useState("DETAILED");
  const [siteType, setSiteType] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      await createConstructionQuote({
        reference,
        customerName,
        siteAddress,
        band,
        durationWeeks: durationWeeks ? Number(durationWeeks) : null,
        enquiryType,
        siteType: siteType || undefined,
        notes,
      });
      // createConstructionQuote redirects to the builder on success.
    });

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <Label htmlFor="q-ref">Project / reference</Label>
          <Input id="q-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Wren Park" />
        </div>
        <div>
          <Label htmlFor="q-cust">Customer</Label>
          <Input id="q-cust" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Stepnell" />
        </div>
        <div>
          <Label htmlFor="q-site">Site address</Label>
          <Input id="q-site" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="Site location" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="q-band">Rate band</Label>
            <Select id="q-band" value={band} onChange={(e) => setBand(e.target.value)}>
              {BAND_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="q-weeks">Duration (weeks)</Label>
            <Input
              id="q-weeks"
              inputMode="numeric"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(e.target.value)}
              placeholder="e.g. 4"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="q-enq">Enquiry type</Label>
            <Select id="q-enq" value={enquiryType} onChange={(e) => setEnquiryType(e.target.value)}>
              <option value="VAGUE">Vague (photos / sentence)</option>
              <option value="SCOPE_OF_WORKS">Scope of works (Excel)</option>
              <option value="DETAILED">Detailed (marked-up drawings)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="q-sitetype">Site type</Label>
            <Select id="q-sitetype" value={siteType} onChange={(e) => setSiteType(e.target.value)}>
              <option value="">—</option>
              {SITE_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="q-notes">Notes / assumptions</Label>
          <textarea
            id="q-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth recording up front."
            className="w-full rounded-lg border border-hairline-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
          />
        </div>
        <div className="flex justify-end pt-1">
          <Button type="button" onClick={submit} disabled={pending} className="gap-1.5">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            Create &amp; continue
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
