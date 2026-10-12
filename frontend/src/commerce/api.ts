import type { Parcel } from "../schema/conveyor";
export type Product = { id:string; name:string; category:string; description:string; price_cents:number; stock:number; weight_kg:number; image_key:string; rack_id:string };
export type Order = { parcels?:Parcel[]; id:string; tracking_code:string; customer_name:string; items:{product_id:string;name:string;quantity:number;unit_price_cents:number}[];subtotal_cents:number;shipping_cents:number;total_cents:number;dispatch_plan?:{vehicle_type:string;total_weight_kg:number;basis:string};current_location?:string;robot_positions?:{id:string;position:number[];floor:number;status:string}[];delivery_method:string;status:string;created_at:string;updated_at:string;estimated_ready_seconds:number;events:{status:string;message:string;at:string}[];task_ids:string[];robot_ids:string[] };
export const money=(cents:number)=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(cents/100);
export const statuses:Record<string,string>={received:'Sipariş alındı',picking:'Ürünler toplanıyor',packing:'Paketleniyor',loading:'Yükleme alanına taşınıyor',ready:'Sevke hazır'};
export async function api<T>(url:string,options:RequestInit={}):Promise<T>{
  let response:Response;
  try { response=await fetch(`/api/commerce${url}`,{...options,headers:{'Content-Type':'application/json',...options.headers}}); }
  catch(error){if(error instanceof DOMException && error.name==='AbortError')throw error;throw new Error('Sunucuya ulaşılamıyor. Backend servisinin açık olduğunu kontrol edip yeniden deneyin.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok){const detail=data?.detail;throw new Error(typeof detail==='string'?detail:response.status===404?'Sipariş bulunamadı. Takip kodunu kontrol edin.':`İşlem tamamlanamadı (${response.status}). Lütfen yeniden deneyin.`);}
  if(data===null)throw new Error('Sunucudan geçerli bir yanıt alınamadı.');
  return data as T;
}
