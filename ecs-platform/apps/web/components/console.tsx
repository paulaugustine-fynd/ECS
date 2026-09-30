'use client';
import { useEffect,useState } from 'react';
import {SimulationStudio} from './simulation-studio';
import {CoachJourney} from './coach-journey';
import {SystemUpdates} from './system-updates';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers3,Building2,Package,ShoppingBag,ChartNoAxesCombined,Link2,Headphones,Bell,Search,ChevronRight,ArrowUpRight,LogOut,RefreshCw,ShieldCheck,Activity,BookOpen,type LucideIcon } from 'lucide-react';
import { api,type User,type Partner } from '../lib/api';
import { CatalogDetail } from './catalog-detail';
import { CatalogImports } from './catalog-imports';
import { Orders } from './orders';
import { Returns } from './returns';
import {SlaCenter} from './sla-center';
import {Notifications} from './notifications';
import {NotificationPolicies} from './notification-policies';
import {Exceptions} from './exceptions';
import {Analytics,reportRoles} from './analytics';
import {Reconciliation} from './reconciliation';
import { Settlements } from './settlements';
import {ComplianceDocuments} from './compliance-documents';
import {PartnerInvitation} from './partner-invitation';
import {Commercials} from './commercials';
import {BrandRights} from './brand-rights';
import {Locations} from './locations';
import {LaunchReadiness} from './launch-readiness';
import {LaunchTestPanel} from './launch-test-panel';
import {PartnerApplicationSummary} from './partner-application-summary';
import { InventoryEditor,type StockRow } from './inventory-editor';
type Product={id:string;sku:string;titleEn:string;titleAr:string;status:string;saleStatus:string;brand:string;price:string;currency:string;data:{media?:{url:string}[]};publications:{target:string;status:string}[]};
type Inventory=StockRow&{product:Product};
const status=(s:string)=>s.replaceAll('_',' ').toLowerCase();
function Badge({value}:{value:string}){return <span className={`badge ${['ACTIVE','PUBLISHED','SUCCEEDED','APPROVED'].includes(value)?'green':['FAILED','DEAD_LETTER','SUSPENDED','REJECTED'].includes(value)?'red':'amber'}`}>{status(value)}</span>;}
export function Console(){
  const path=usePathname();const vendor=path.startsWith('/vendor');const section=path.split('/').slice(2).join('/')||'dashboard';
  const[decisionReason,setDecisionReason]=useState('');
  const[refreshToken,setRefreshToken]=useState(0);
  const[unread,setUnread]=useState<number|null>(null);
  const[user,setUser]=useState<User|null>(null),[error,setError]=useState(''),[ar,setAr]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
  const[partners,setPartners]=useState<Partner[]>([]),[products,setProducts]=useState<Product[]>([]),[inventory,setInventory]=useState<Inventory[]>([]),[selected,setSelected]=useState<Partner|null>(null);
  const t=(en:string,arabic:string)=>ar?arabic:en;
  const root=vendor?'/vendor':'/operator';
  async function load(){setError('');try{
    const me=await api<{user:User}>('/auth/me');setUser(me.user);
    if(me.user.role.startsWith('VENDOR_')!==vendor){location.href=me.user.role.startsWith('VENDOR_')?'/vendor/dashboard':'/operator/dashboard';return;}
    setPartners((await api<{items:Partner[]}>('/partners?limit=100')).items);
    if(['dashboard','catalog','catalog/items'].includes(section))setProducts((await api<{items:Product[]}>('/catalog/items?limit=100')).items);
    if(section==='inventory')setInventory((await api<{items:Inventory[]}>('/inventory?limit=100')).items);
  }catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[path]); // Server re-checks session and ownership on every request.
  useEffect(()=>{if(!user?.id)return;let active=true;const poll=async()=>{try{const n=await api<{unread:number}>('/notifications?limit=1');if(active)setUnread(n.unread);}catch{if(active)setUnread(null);}};void poll();const timer=setInterval(()=>void poll(),15000);return()=>{active=false;clearInterval(timer);};},[user?.id,refreshToken]);
  useEffect(()=>{document.documentElement.lang=ar?'ar':'en';document.documentElement.dir=ar?'rtl':'ltr';return()=>{document.documentElement.dir='ltr';};},[ar]);
  const nav:[string,string,LucideIcon][]=[['dashboard',t('Overview','نظرة عامة'),Building2],['partners',t(vendor?'My profile':'Partners & brands',vendor?'ملفي':'الشركاء والعلامات'),ShieldCheck],['catalog/items',t('My products','منتجاتي'),Package],['inventory',t('Inventory','المخزون'),Layers3]];
  nav.push(['locations',t('Locations','المواقع'),Building2]);
  nav.push(['notifications',t('Notifications','الإشعارات'),Bell]);
  if(!vendor&&['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER'].includes(user?.role??''))nav.push(['integrations',t('System updates','تحديثات الأنظمة'),Link2]);
  if(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR'].includes(user?.role??''))nav.splice(4,0,['orders',t('My orders','طلباتي'),ShoppingBag]);
  const titles:Record<string,string>={dashboard:t('Concessions overview','نظرة عامة على الامتيازات'),partners:t('Partners & brands','الشركاء والعلامات'),'catalog/items':t('My products','منتجاتي'),catalog:t('My products','منتجاتي'),inventory:t('Inventory','المخزون'),locations:t('Locations','المواقع'),integrations:t('System updates','تحديثات الأنظمة')};
  if(section.startsWith('catalog/items/'))titles[section]=t('Product review','مراجعة المنتج');
  if(reportRoles.includes(user?.role??''))nav.push(['analytics',t('Analytics','التحليلات'),ChartNoAxesCombined]);
  if(section==='analytics')titles[section]=t('Analytics','التحليلات');
  if(['ATI_SUPER_ADMIN','ATI_FINANCE_ANALYST','ATI_AUDITOR'].includes(user?.role??''))nav.push(['reconciliation',t('Reconciliation','المطابقة'),ShieldCheck]);
  if(section==='reconciliation')titles[section]=t('Reconciliation','المطابقة');
  if(section.startsWith('orders'))titles[section]=section==='orders'?t('My orders','طلباتي'):t('Shipment details','تفاصيل الشحنة');
  if(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR'].includes(user?.role??''))nav.push(['returns',t('Returns','المرتجعات'),Package]);
  if(['ATI_SUPER_ADMIN','ATI_FINANCE_ANALYST','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'].includes(user?.role??''))nav.push(['settlements',t('Finance & settlements','المالية والتسويات'),ChartNoAxesCombined]);
  if(section.startsWith('returns'))titles[section]=t('Returns','المرتجعات');
  if(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR'].includes(user?.role??''))nav.push(['sla',t('SLA & exceptions','مستويات الخدمة والاستثناءات'),Activity]);
  if(section==='sla')titles[section]=t('SLA & exceptions','مستويات الخدمة والاستثناءات');
  if(section==='notifications')titles[section]=t('Notifications','الإشعارات');
  if(section==='notifications/routing')titles[section]=t('Notification routing','توجيه الإشعارات');
  if(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_CATALOG_MODERATOR','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR','VENDOR_CATALOG_MANAGER'].includes(user?.role??''))nav.push(['exceptions',t('Exception centre','مركز الاستثناءات'),Activity]);
  if(section.startsWith('exceptions'))titles[section]=t('Exception centre','مركز الاستثناءات');
  if(section.startsWith('settlements'))titles[section]=t('Finance & settlements','المالية والتسويات');
  if(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_FINANCE_ANALYST','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'].includes(user?.role??''))nav.push(['commercials',t('Commercial terms','الشروط التجارية'),ShieldCheck]);
  if(section==='commercials')titles[section]=t('Commercial terms','الشروط التجارية');
  if(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_CATALOG_MODERATOR','ATI_OPERATIONS_MANAGER','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_CATALOG_MANAGER'].includes(user?.role??''))nav.push(['brands',t('Brand rights','حقوق العلامات التجارية'),ShieldCheck]);
  if(section==='brands')titles[section]=t('Brand rights','حقوق العلامات التجارية');
  if(['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR','VENDOR_ADMIN','VENDOR_CATALOG_MANAGER'].includes(user?.role??''))nav.splice(3,0,['catalog/imports',t('Catalogue imports','استيراد الكتالوج'),Package]);
  if(section.startsWith('catalog/imports'))titles[section]=t('Catalogue imports','استيراد الكتالوج');
  if(!vendor&&user?.role.startsWith('ATI_'))nav.splice(1,0,['simulations',t('Simulation Studio','استوديو المحاكاة'),Activity]);
  if(section.startsWith('simulations'))titles[section]=t('Simulation Studio','استوديو المحاكاة');
  if(!vendor&&user?.role.startsWith('ATI_'))nav.splice(1,0,['coach','Coach UAE walkthrough',BookOpen]);
  if(section.startsWith('coach'))titles[section]='Coach UAE walkthrough';
  async function openPartner(id:string){setError('');setDecisionReason('');try{setSelected(await api<Partner>(`/partners/${id}`));}catch(e){setError((e as Error).message);}}
  async function command(action:string){if(!selected)return;const reason=['request-info','reject','pause','suspend','offboard','authorize-brand'].includes(action)?decisionReason.trim():undefined;if(reason!==undefined&&reason.length<5)return;setBusy(true);setError('');try{await api(`/partners/${selected.id}/commands`,{action,expectedVersion:selected.version,reason});await openPartner(selected.id);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const allowedActions=selected?({SUBMITTED:['review'],UNDER_REVIEW:['request-info','approve','reject'],APPROVED:['sync-erp','map-fynd','sync-inventory','activate'],ACTIVE:['map-fynd','sync-inventory','pause','suspend'],PAUSED:['map-fynd','sync-inventory','activate','suspend'],SUSPENDED:['offboard']} as Record<string,string[]>)[selected.status]??[]:[];
  const canManage=!vendor&&['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER'].includes(user?.role??'');
  return <div className="console">
    <header className="console-header"><Link className="console-logo" href="/"><Layers3 size={29}/></Link><span className="commerce">Commerce</span><div className="console-search"><Search size={16}/><span>{t('External concessions workspace','مساحة عمل الامتيازات الخارجية')}</span></div><span className="env">{process.env.NEXT_PUBLIC_ECS_HOSTED_DEMO==='true'?'HOSTED DEMO':'LOCAL DEMO'}</span><Headphones size={20}/><Link className="notification-bell" href={`${root}/notifications`} aria-label={unread===null?'Notifications':`Notifications, ${unread} unread`}><Bell size={19}/>{unread!==null&&unread>0&&<span>{unread>99?'99+':unread}</span>}</Link><div className="identity"><span className="avatar">{user?.name.split(' ').map(n=>n[0]).slice(0,2).join('')??'AT'}</span><div><b>{vendor?'PARTNER':'AL TAYER INSIGNIA'}</b><small>{user?.name??'Authenticating…'}</small></div></div></header>
    <aside className="app-rail">{[[Building2,'Company','partners'],[Package,'Products','catalog/items'],[ShoppingBag,'Inventory','inventory'],[ChartNoAxesCombined,'Overview','dashboard'],[Link2,'Konnect','integrations']].filter(n=>n[2]!=='integrations'||!vendor&&['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER'].includes(user?.role??'')).map(([Icon,label,url])=>{const I=Icon as typeof Building2;return <Link href={`${root}/${url}`} className={section===url?'active':''} key={String(label)}><I size={21}/><span>{String(label)}</span></Link>;})}<Link href="/" className="rail-bottom"><ArrowUpRight size={21}/><span>Demo home</span></Link></aside>
    <aside className="section-nav"><span className="nav-eyebrow">{t('EXTERNAL CONCESSIONS','الامتيازات الخارجية')}</span>{nav.map(([url,label,Icon])=><Link href={`${root}/${url}`} key={url} className={section===url||section.startsWith(`${url}/`)?'selected':''}><Icon size={18}/>{label}</Link>)}<div className="nav-context"><span className="eyebrow">{t('OPERATING CONTEXT','سياق التشغيل')}</span><b>Bloomingdale’s UAE</b><p>AE · AED · {t('English / Arabic','العربية / الإنجليزية')}</p><span className="pill"><span className="dot"/>{t('Mock integrations','تكاملات محاكاة')}</span></div><button className="logout" disabled={!user} onClick={async()=>{try{await api('/auth/logout',{});location.href='/login';}catch(e){setError((e as Error).message);}}}><LogOut size={16}/>{t('Sign out','تسجيل الخروج')}</button></aside>
    <main className="console-main"><div className="context-strip"><span>Commerce <ChevronRight size={12}/> External concessions <ChevronRight size={12}/> {titles[section]}</span><button onClick={()=>setAr(!ar)}>{ar?'English':'العربية'}</button></div>
    <div className="page-title"><div><h1>{titles[section]??'Workspace'}</h1><p>{t('One retail experience. Connected partner operations.','تجربة تجزئة واحدة. عمليات شركاء متصلة.')}</p></div><button className="button" onClick={()=>{setRefreshToken(v=>v+1);void load();}}><RefreshCw size={15}/>{t('Refresh','تحديث')}</button></div>
    {error&&<div className="error" role="alert">{error} {!user&&<Link href="/login">Sign in</Link>}</div>}
    {user&&!vendor&&section.startsWith('simulations')&&<SimulationStudio key={section} scenarioId={section.split('/')[1]} ar={ar}/>}
    {user&&!vendor&&section.startsWith('coach')&&<CoachJourney key={section}/>}
    {user&&!vendor&&section==='dashboard'&&<Link className="sim-banner" href="/operator/coach"><BookOpen size={20}/><div><b>Start here: Coach UAE walkthrough</b><span>One saved journey from application to statement, with clear steps for every team</span></div><ArrowUpRight size={18}/></Link>}
    {section==='partners'&&canManage&&<PartnerInvitation onCreated={load}/>}
    {user&&section==='dashboard'&&<><div className="welcome"><div><span className="eyebrow">{t('YOUR BUSINESS AT A GLANCE','لمحة عن أعمالك')}</span><h2>{t('Good to see you,','أهلاً بك،')} {user.name.split(' ')[0]}.</h2><p>{t('Review new applications and keep your concession partners moving.','راجع الطلبات الجديدة وتابع شركاء الامتيازات.')}</p><Link className="primary" href={`${root}/partners`}>{t('Review partners','مراجعة الشركاء')}<ArrowUpRight size={16}/></Link></div><div className="welcome-mark"><Layers3 size={64}/><span>ECS</span></div></div>
    <div className="metrics">{[[partners.length,t('Partner records','سجلات الشركاء')],[partners.filter(p=>p.status==='ACTIVE').length,t('Active partners','الشركاء النشطون')],[products.length,t('Catalogue items','عناصر الكتالوج')],[products.filter(p=>p.status==='PUBLISHED').length,t('Published products','منتجات منشورة')]].map(([n,l])=><div className="metric" key={l}><span>{l}</span><strong>{n}</strong><small>{t('From your authorized records','من سجلاتك المصرح بها')}</small></div>)}</div>
    <div className="dashboard-columns"><section className="panel"><div className="panel-title"><h2>{t('Needs your attention','يحتاج إلى انتباهك')}</h2><span className="count">{partners.filter(p=>p.status!=='ACTIVE').length}</span></div>{partners.filter(p=>p.status!=='ACTIVE').map(p=><button className="attention-row" key={p.id} onClick={()=>void openPartner(p.id)}><span className="brand-initial">{p.displayName[0]}</span><span><b>{p.displayName}</b><small>{p.legalName}</small></span><Badge value={p.status}/><ChevronRight size={18}/></button>)}</section><section className="panel"><div className="panel-title"><h2>{t('The operating model','نموذج التشغيل')}</h2><Activity size={18}/></div>{[['SFCC','Storefront, checkout & payment'],['ECS','Governance, partner workflow & finance'],['Fynd','Proposed operational commerce layer'],['ATI Finance','Accounting & external payout']].map(([a,b])=><div className="ownership" key={a}><b>{a}</b><span>{b}</span></div>)}<p className="footnote">{t('Mock adapters demonstrate the handoffs. Tenant capabilities are not yet validated.','توضح المحاكاة تبادل البيانات. لم يتم التحقق من قدرات بيئة العميل بعد.')}</p></section></div></>}
    {user&&section.startsWith('catalog/items/')&&<CatalogDetail id={section.split('/')[2]} user={user} root={root}/>}
    {user&&section.startsWith('catalog/imports')&&<CatalogImports user={user} root={root} id={section.split('/')[2]} refreshToken={refreshToken}/>}
    {user&&section.startsWith('orders')&&<Orders user={user} root={root} id={section.split('/')[1]}/>}
    {user&&section.startsWith('returns')&&<Returns user={user} root={root} id={section.split('/')[1]}/>}
    {user&&section==='sla'&&<SlaCenter user={user} root={root} refreshToken={refreshToken}/>}
    {user&&section==='notifications'&&<>{user.role==='ATI_SUPER_ADMIN'&&<div className="operations-toolbar"><Link className="text-button" href={`${root}/notifications/routing`}>Configure notification routing →</Link></div>}<Notifications root={root} refreshToken={refreshToken} onUnread={setUnread}/></>}
    {user&&section==='notifications/routing'&&(user.role==='ATI_SUPER_ADMIN'?<NotificationPolicies user={user} root={root} refreshToken={refreshToken}/>:<p className="error" role="alert">Only ATI administrators can configure notification routing.</p>)}
    {user&&section.startsWith('exceptions')&&<Exceptions user={user} root={root} id={section.split('/')[1]} refreshToken={refreshToken}/>}
    {user&&section.startsWith('settlements')&&<Settlements user={user} root={root} id={section.split('/')[1]}/>}
    {user&&section==='commercials'&&<Commercials user={user}/>}
    {user&&section==='brands'&&<BrandRights user={user} refreshToken={refreshToken}/>}
    {user&&section==='locations'&&<Locations user={user} refreshToken={refreshToken}/>}
    {user&&section==='analytics'&&<Analytics user={user} root={root} refreshToken={refreshToken}/>}
    {user&&section==='reconciliation'&&<Reconciliation user={user} refreshToken={refreshToken}/>}
    {!section.startsWith('simulations')&&section!=='reconciliation'&&section!=='analytics'&&!section.startsWith('exceptions')&&!section.startsWith('notifications')&&section!=='sla'&&section!=='locations'&&section!=='brands'&&section!=='commercials'&&section!=='dashboard'&&!section.startsWith('catalog/imports')&&!section.startsWith('catalog/items/')&&!section.startsWith('orders')&&!section.startsWith('returns')&&!section.startsWith('settlements')&&<section className="panel data-panel"><div className="table-toolbar"><label className="search-input"><Search size={17}/><input aria-label="Search records" placeholder={t('Search records…','البحث في السجلات…')} value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="muted">{t('Bloomingdale’s UAE','بلومينغديلز الإمارات')} · AE</span></div>
    {section==='partners'&&<table><thead><tr>{['Partner','Markets','ERP identity','Status',''].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{partners.filter(p=>(p.displayName+p.legalName).toLowerCase().includes(query.toLowerCase())).map(p=><tr key={p.id}><td><b>{p.displayName}</b><small>{p.legalName}</small></td><td>{p.markets.join(' · ')}</td><td>{p.erpVendorId??'Awaiting sync'}</td><td><Badge value={p.status}/></td><td><button className="text-button" onClick={()=>void openPartner(p.id)}>{t('Review','مراجعة')} →</button></td></tr>)}</tbody></table>}
    {['catalog','catalog/items'].includes(section)&&products.filter(p=>(p.titleEn+p.sku).toLowerCase().includes(query.toLowerCase())).map(p=><Link href={`${root}/catalog/items/${p.id}`} className="product-row" key={p.id}><span className={`product-dot ${p.status==='PUBLISHED'&&p.saleStatus==='ENABLED'?'live':''}`}/><img src={p.data.media?.[0]?.url??'/demo-assets/maz-dress-black.svg'} alt="Demo product illustration"/><div><b>{ar?p.titleAr||p.titleEn:p.titleEn}</b><p>{p.brand} <span>│</span> {p.sku}</p><div className="publication-tags">{p.publications.map((pub,n)=><span key={`${pub.target}-${n}`}>{pub.target} · {status(pub.status)}</span>)}</div></div><div className="product-price"><b>{p.currency} {p.price}</b><Badge value={p.status}/>{p.saleStatus!=='ENABLED'&&<span className={`badge ${p.saleStatus==='DELISTED'?'red':'amber'}`}>{p.saleStatus==='DELISTED'?t('Delisted','غير مدرج'):t('Sales paused','المبيعات متوقفة')}</span>}</div><ChevronRight size={16}/></Link>)}
    {section==='inventory'&&<table><thead><tr>{['SKU / location','Physical','Reserved','Safety stock','Sellable',''].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{inventory.filter(r=>(r.product.sku+r.location.name).toLowerCase().includes(query.toLowerCase())).map(r=><tr key={r.id}><td><b>{r.product.sku}</b><small>{r.location.name}</small></td><td>{r.onHand}</td><td>{r.reserved}</td><td>{r.safetyStock}</td><td><b>{r.sellable}</b></td><td>{user&&<InventoryEditor row={r} user={user} onSaved={load}/>}</td></tr>)}</tbody></table>}
    {section==='integrations'&&<SystemUpdates query={query} refreshToken={refreshToken}/>}
    </section>}
    <p className="build-note">Database-backed demo · Mock integrations · Full requirement coverage remains in progress</p></main>
    {selected&&<div className="drawer-backdrop" onClick={()=>setSelected(null)}><aside className="drawer" aria-label="Partner details" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelected(null)} aria-label="Close partner details">×</button><span className="eyebrow">{selected.code}</span><h2>{selected.displayName}</h2><p>{selected.legalName}</p><Badge value={selected.status}/><h3>Launch readiness</h3><LaunchReadiness gates={selected.readiness??[]}/><button className="text-button" disabled={busy} onClick={()=>void openPartner(selected.id)}>Refresh readiness evidence</button>{['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_OPERATIONS_MANAGER','ATI_AUDITOR','VENDOR_ADMIN'].includes(user?.role??'')&&<LaunchTestPanel partner={selected} canRun={canManage} onChanged={()=>openPartner(selected.id)}/>}<h3>Business application</h3><PartnerApplicationSummary partner={selected} ar={ar}/><h3>Compliance documents</h3><ComplianceDocuments partner={selected} canReview={canManage} ar={ar} onChanged={()=>openPartner(selected.id)}/>{canManage&&<><label className="decision-reason">{t('Decision reason / evidence reference','سبب القرار أو مرجع الإثبات')}<input value={decisionReason} onChange={e=>setDecisionReason(e.target.value)} placeholder={t('Required for feedback, rejection or brand authorization','مطلوب للملاحظات أو الرفض أو التفويض')}/></label><div className="drawer-actions">{allowedActions.map(a=><button className="button" key={a} disabled={busy||(['request-info','reject','pause','suspend','offboard','authorize-brand'].includes(a)&&decisionReason.trim().length<5)} onClick={()=>void command(a)}>{({review:'Start application review','request-info':'Ask partner for corrections',approve:'Approve partner',reject:'Reject application','sync-erp':'Register business for finance','map-fynd':'Prepare brand and locations','sync-inventory':'Send latest stock',activate:'Open for sales',pause:'Pause new sales',suspend:'Suspend partner',offboard:'Close partnership'} as Record<string,string>)[a]??a}</button>)}</div></>}{error&&<div className="error" role="alert">{error}</div>}</aside></div>}
  </div>;
}
