import Link from 'next/link';
import { ArrowUpRight, ShieldCheck, Layers3, Store } from 'lucide-react';
export default function Home(){return <main className="launch">
  <header className="launch-header"><img src="/brand/bloomingdales-wordmark.svg" alt="Bloomingdale’s"/><span>AL TAYER INSIGNIA</span></header>
  <div className="launch-intro"><span className="eyebrow">EXTERNAL CONCESSIONS · UAE</span><h1>Exceptional brands.<br/>One seamless experience.</h1><p>A connected workspace for the people behind Bloomingdale’s.<br/>From the first introduction to the final settlement.</p></div>
  <div className="portal-grid">{[
    {icon:Store,kicker:'FOR OUR BRAND PARTNERS',title:'Become a partner',copy:'Your application, compliance documents and launch readiness. A dedicated Bloomingdale’s journey.',href:'/login?next=/onboarding',cta:'Partner application'},
    {icon:Layers3,kicker:'FOR EXISTING PARTNERS',title:'Your brand workspace',copy:'Manage your assortment, inventory and fulfilment. Your team sees only your brand’s operations.',href:'/login?next=/vendor/dashboard',cta:'Partner sign in'},
    {icon:ShieldCheck,kicker:'FOR AL TAYER TEAMS',title:'Concessions console',copy:'Approve partners, govern your catalogue and follow each operational handoff in one place.',href:'/login?next=/operator/dashboard',cta:'ATI team sign in'},
  ].map(p=><Link href={p.href} className="portal" key={p.title}><p.icon size={26}/><span className="eyebrow">{p.kicker}</span><h2>{p.title}</h2><p>{p.copy}</p><span className="portal-link">{p.cta}<ArrowUpRight size={18}/></span></Link>)}</div>
  <div className="launch-note"><span className="dot"/> Local demonstration · PostgreSQL-backed workflows · Mock external systems · Not a live Fynd connection</div>
</main>;}
