import Link from "next/link"
import { ArrowRight,ArrowUpRight,ShieldCheck,Users } from "lucide-react"

function CourtArtwork({organizer=false}:{organizer?:boolean}) {
  return <svg viewBox="0 0 640 640" fill="none" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    {organizer ? <>
      <path d="M302 56h106v72H302zM466 176h106v72H466zM302 296h106v72H302zM138 176h106v72H138z" stroke="white" strokeOpacity=".22"/>
      <path d="M355 128v48m0 0H191m164 0h164M191 176v0m328 72v84H408m-53-84v48" stroke="white" strokeOpacity=".3"/>
      <path d="M318 79h56M318 95h35M482 199h56M482 215h35M318 319h56M318 335h35M154 199h56M154 215h35" stroke="white" strokeOpacity=".4" strokeWidth="3"/>
      <circle cx="355" cy="176" r="6" fill="#e9c650"/>
      <path d="M38 580 610 8M148 640 640 148" stroke="white" strokeOpacity=".04" strokeWidth="90"/>
    </> : <>
      <g transform="translate(45 -82) rotate(24 320 320)">
        <path d="M76 86h488v684H76z" stroke="white" strokeOpacity=".24" strokeWidth="2"/>
        <path d="M106 86v684m428-684v684M76 170h488M76 428h488M76 686h488M320 86v262m0 160v262" stroke="white" strokeOpacity=".19" strokeWidth="2"/>
        <path d="M56 428h528" stroke="#bceede" strokeOpacity=".65" strokeWidth="3"/>
        <path d="M76 348h488M76 508h488" stroke="white" strokeOpacity=".3" strokeWidth="2"/>
      </g>
      <path d="M368 211c30-79 83-114 158-141" stroke="#e9c650" strokeOpacity=".45" strokeDasharray="4 9" strokeWidth="2"/>
      <g transform="translate(362 158) rotate(22)">
        <path d="m0 50-19-49 12 3 8-6 9 6 12-3-19 49" fill="white" fillOpacity=".75"/>
        <path d="M-7 5 0 50M9 6 3 50" stroke="#135c58" strokeOpacity=".5"/>
        <path d="M0 50c-8 1-10 12-5 17 4 4 11 2 13-3 3-6-1-13-8-14Z" fill="#e9c650"/>
      </g>
    </>}
  </svg>
}

const primaryAction="group/action inline-flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl px-5 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d76a] focus-visible:ring-offset-4 focus-visible:ring-offset-[#102d37] motion-safe:transition-colors sm:min-h-16 sm:text-base"

type OrganizerAccess = { href: string; label: string; description: string; caption: string }

export default function ImmersiveAccess({organizer}:{organizer:OrganizerAccess}) {
  return <div className="@container text-white">
      <div className="grid gap-5 @3xl:grid-cols-2 @3xl:gap-6">
        <section aria-labelledby="community-access-title" className="relative isolate flex min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#123f43] p-3 shadow-[0_22px_70px_-30px_#0008] sm:rounded-[32px] sm:p-5">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_90%_0%,#36877b,transparent_65%),linear-gradient(160deg,#16444d_10%,#103630_65%,#0c2534)]" aria-hidden="true" />
          <CourtArtwork />
          <div className="relative flex flex-wrap items-center justify-between gap-2"><span className="rounded-full border border-white/20 bg-[#06232d]/35 px-3 py-2 text-[10px] font-bold uppercase tracking-[.18em] backdrop-blur-md">For the love of the game</span><span className="text-xs font-medium tracking-widest text-white/70" aria-hidden="true">01 / PLAY</span></div>
          <div className="relative mt-16 flex flex-1 flex-col rounded-[22px] border border-white/15 bg-[#061e2a]/65 p-5 shadow-[inset_0_1px_0_#ffffff12] backdrop-blur-xl sm:mt-20 sm:p-6">
            <div className="mb-5 flex items-center gap-2 text-[#b5dfd4]"><Users className="size-4" aria-hidden="true" /><p className="text-[10px] font-bold uppercase tracking-[.2em]">Players & community</p></div>
            <h2 id="community-access-title" className="text-[clamp(2rem,5cqi,3.5rem)] font-semibold leading-[1.04] tracking-[-.045em]">Join the <br />community<span className="text-[#e9c650]">.</span></h2>
            <p className="mb-7 mt-4 max-w-sm text-sm leading-6 text-slate-200">Enter tournaments, team up with friends, and follow every point. Your next game starts here.</p>
            <div className="mt-auto"><div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium text-[#b6d3d3]"><span>Singles & doubles</span><span className="size-1 rounded-full bg-[#e9c650]" aria-hidden="true" /><span>Live scores</span></div><Link href="/tournaments" className={`${primaryAction} bg-[#e9c650] text-[#092431] hover:bg-[#f3d76a]`}><span>Join Now</span><ArrowRight className="size-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover/action:translate-x-1" aria-hidden="true" /></Link></div>
          </div>
        </section>

        <section aria-labelledby="organizer-access-title" className="relative isolate flex min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#132c47] p-3 shadow-[0_22px_70px_-30px_#0008] sm:rounded-[32px] sm:p-5">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_90%_5%,#5c6486,transparent_55%),linear-gradient(155deg,#193c56,#172c45_55%,#182131)]" aria-hidden="true" />
          <CourtArtwork organizer />
          <div className="relative flex flex-wrap items-center justify-between gap-2"><span className="rounded-full border border-white/20 bg-[#0c2035]/35 px-3 py-2 text-[10px] font-bold uppercase tracking-[.18em] backdrop-blur-md">Behind every great match</span><span className="text-xs font-medium tracking-widest text-white/70" aria-hidden="true">02 / ORGANIZE</span></div>
          <div className="relative mt-16 flex flex-1 flex-col rounded-[22px] border border-white/15 bg-[#0c1d31]/70 p-5 shadow-[inset_0_1px_0_#ffffff12] backdrop-blur-xl sm:mt-20 sm:p-6">
            <div className="mb-5 flex items-center gap-2 text-[#cad4ee]"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" /><p className="text-[10px] font-bold uppercase tracking-[.2em]">{organizer.caption}</p></div>
            <h2 id="organizer-access-title" className="text-[clamp(2rem,5cqi,3.5rem)] font-semibold leading-[1.04] tracking-[-.045em]">Organizer <br />access<span className="text-[#e9c650]">.</span></h2>
            <p className="mb-7 mt-4 max-w-sm text-sm leading-6 text-slate-200">{organizer.description}</p>
            <div className="mt-auto"><div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium text-[#bdcde1]"><span>Draws</span><span className="size-1 rounded-full bg-[#e9c650]" aria-hidden="true" /><span>Scheduling</span><span className="size-1 rounded-full bg-[#e9c650]" aria-hidden="true" /><span>Match duties</span></div><Link href={organizer.href} className={`${primaryAction} border border-white/35 bg-white/5 text-white hover:border-white/60 hover:bg-white/15`}><span>{organizer.label}</span><ArrowUpRight className="size-5 shrink-0 motion-safe:transition-transform motion-safe:group-hover/action:-translate-y-0.5 motion-safe:group-hover/action:translate-x-0.5" aria-hidden="true" /></Link></div>
          </div>
        </section>
      </div>

  </div>
}
