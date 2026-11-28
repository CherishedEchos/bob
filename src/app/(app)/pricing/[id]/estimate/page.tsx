"use client";

/**
 * The rough estimate for one job to price, on its own page so it has room on a
 * phone. Opening it again resumes the same saved draft. Nothing here sends a
 * quote or contacts the customer.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { EstimatePanel } from "@/components/pricing/estimate-panel";

export default function EstimatePage() {
  const { id } = useParams<{ id: string }>();
  const { data, can, org } = useStore();
  const e = data.enquiries.find((x) => x.id === id);
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <Link href={`/pricing/${id}`} className="inline-flex h-10 items-center gap-1.5 self-start text-[15px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {e ? `${e.title} · ${e.customerName}` : "Back"}
      </Link>
      {!e ? (
        <p className="text-[16px]">This pricing record wasn&apos;t found.</p>
      ) : !org.features?.roughEstimates || !can("quotes.write") ? (
        <p className="panel px-5 py-4 text-[16px]">Rough estimates aren&apos;t switched on for this business. The owner can switch them on in Settings → Prices for estimates.</p>
      ) : (
        <EstimatePanel enquiry={e} />
      )}
    </div>
  );
}
