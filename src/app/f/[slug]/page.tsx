import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publicFormInfo } from "@/server/services/website-form";
import { EnquiryForm } from "./form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const info = publicFormInfo((await params).slug);
  return { title: info ? `Enquire — ${info.name}` : "Enquiry form", robots: { index: false, follow: false } };
}

/** Public enquiry form for a workspace. ?embed=1 renders it bare for an <iframe> on the business's own site. */
export default async function PublicEnquiryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { slug } = await params;
  const embed = (await searchParams).embed === "1";
  const info = publicFormInfo(slug);
  if (!info) notFound();
  return (
    <main className={embed ? "min-h-dvh bg-transparent p-1 text-[#1c1917]" : "min-h-dvh bg-[#f6f4f1] px-4 py-8 text-[#1c1917] sm:py-14"} style={{ colorScheme: "light" }}>
      <EnquiryForm slug={slug} name={info.name} shortName={info.shortName} logoUrl={info.logoUrl} services={info.services} embed={embed} />
    </main>
  );
}
