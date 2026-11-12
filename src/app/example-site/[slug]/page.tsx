import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { publicFormInfo } from "@/server/services/website-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Example website (demo)", robots: { index: false, follow: false } };

/**
 * A plain sample website for demos: shows what the Bob enquiry form looks
 * like on a trade business's own site. Clearly labelled as an example.
 */
export default async function ExampleSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const info = publicFormInfo(slug);
  if (!info) notFound();
  return (
    <div className="min-h-dvh bg-[#f6f4f1] text-[#1c1917]" style={{ colorScheme: "light" }}>
      <div className="bg-[#1c1917] px-4 py-2 text-center text-[13px] text-[#e7e5e4]">
        <strong className="font-semibold text-white">Example website — demo only.</strong> It shows how the Bob enquiry form looks on a business&apos;s own site.
      </div>
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-5">
        {info.logoUrl ? <Image src={info.logoUrl} alt="" width={44} height={44} className="rounded-full" /> : null}
        <span className="text-[18px] font-bold tracking-tight">{info.name}</span>
      </header>
      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-5 pb-16 pt-4 lg:grid-cols-[1fr_440px]">
        <section>
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#c2410c]">{info.trade ?? "Trades"}</p>
          <h1 className="mt-2 text-[38px] font-bold leading-[1.08] tracking-tight sm:text-[46px]">Quality work, done properly.</h1>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-[#57534e]">Tell us about your project and we&apos;ll get back to you with next steps.</p>
          {info.services.length ? (
            <ul className="mt-8 grid max-w-md grid-cols-2 gap-2">
              {info.services.slice(0, 8).map((s) => (
                <li key={s} className="rounded-xl border border-[#e5dfd7] bg-white px-3.5 py-2.5 text-[15px]">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="rounded-2xl border border-[#e5dfd7] bg-white p-5 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.25)]">
          <h2 className="mb-3 text-[20px] font-semibold tracking-tight">Get a quote</h2>
          <iframe title={`Enquiry form for ${info.name}`} src={`/f/${encodeURIComponent(slug)}?embed=1`} className="h-[640px] w-full border-0" />
        </section>
      </main>
    </div>
  );
}
