import {lazy,Suspense,useEffect,useState} from 'react';
import Storefront from './commerce/Storefront';
import Tracking from './commerce/Tracking';
import './commerce/commerce.css';
const WarehouseApp=lazy(()=>import('./WarehouseApp'));
const Admin=lazy(()=>import('./commerce/Admin'));
const ResearchApp=lazy(()=>import('./ResearchApp'));
function getRoute(){const raw=window.location.hash.slice(1)||'shop';const [view,...parts]=raw.split('/');let code='';try{code=decodeURIComponent(parts.join('/'))}catch{}return{view:['shop','track','admin','warehouse','research'].includes(view)?view:'shop',code};}
export default function App(){const [route,setRoute]=useState(getRoute);useEffect(()=>{const change=()=>setRoute(getRoute());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);useEffect(()=>{document.title=`WareTwin | ${{shop:'Mağaza',track:'Sipariş takibi',admin:'Operasyon merkezi',warehouse:'Depo simülasyonu',research:'Koordinasyon laboratuvarı'}[route.view]||'Dijital ikiz'}`;document.documentElement.lang='tr'},[route.view]);
 if(route.view==='research')return <Suspense fallback={<div className="app-loading">Koordinasyon laboratuvarı yükleniyor…</div>}><ResearchApp/></Suspense>;
 if(route.view==='warehouse')return <div className="warehouse-route"><Suspense fallback={<div className="app-loading">Depo simülasyonu yükleniyor…</div>}><WarehouseApp/></Suspense></div>;
 return <div className="commerce-app"><div className="c-announcement">Akıllı alışveriş, görünür operasyonlar. <span>WareTwin dijital ikiz platformu ↗</span></div><header className="commerce-header"><a className="commerce-brand" href="#shop" aria-label="WareTwin ana sayfa"><span className="brand-symbol">w<span>•</span></span><div>ware<span>twin</span><small>COMMERCE & OPERATIONS</small></div></a><nav aria-label="Ana gezinme"><a href="#research">Deney laboratuvarı</a><a className={route.view==='shop'?'active':''} href="#shop">Mağaza</a><a className={route.view==='track'?'active':''} href="#track">Sipariş takibi</a><a className={route.view==='admin'?'active':''} href="#admin">Operasyon merkezi</a></nav><a className="header-warehouse" href="#warehouse"><span className="c-dot"/> Canlı depo <span>↗</span></a></header><Suspense fallback={<div className="catalog-loading">Sayfa yükleniyor…</div>}>{route.view==='admin'?<Admin/>:route.view==='track'?<Tracking code={route.code}/>:<Storefront/>}</Suspense></div>
}
