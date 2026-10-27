/* SHOPAY: shared business rules and customer actions.
   Present in this order: seed → cart → quote → checkout → seller completion → forecast.
   Use one static-server origin for index.html and admin.html so LocalStorage is shared. */
'use strict';
const KEY = 'ecommerce_shopay_v1', SESSION_KEY = 'ecommerce_current_user';
const CATEGORIES = ['Electronics', 'Fashion', 'Home & Living', 'Beauty', 'Sports & Outdoors'];
const CURRENCY_FORMAT = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}), NUMBER_FORMAT = new Intl.NumberFormat('en-PH',{maximumFractionDigits:1});
const STATUSES = {Pending:['Processing','Canceled'], Processing:['Shipped','Canceled'], Shipped:['Delivered'], Delivered:['Completed'], Completed:[], Canceled:[]};
let store, activeUserId, selectedProductId = '', checkoutToken = '', category = 'All';
let soldCacheState, soldCache = new Map(); // Reuse completed totals until the dataset changes.
// Small helpers keep repeated formatting, element lookup, and date handling in one place.
function byId(id) { return document.getElementById(id); } // Find one HTML element.
function money(amount) { return Math.round((amount + Number.EPSILON) * 100) / 100; } // Centavos.
function ceilUnits(quantity) { return Math.ceil(Number(quantity.toFixed(9))); } // Avoid phantom units.
// Escape user text before inserting it into HTML or attributes.
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Display peso amounts consistently; this does not change stored calculations.
function formatCurrency(amount) { return CURRENCY_FORMAT.format(amount || 0); }
// Display analytical quantities with at most one decimal place.
function formatNumber(value) { return NUMBER_FORMAT.format(value || 0); }
// Turn a saved timestamp into a readable Philippine calendar date.
function formatDate(value) { return new Date(value).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}); }
// Create a local YYYY-MM-DD key for day, week, and expiry comparisons.
function dateKey(value) { const d = new Date(value);
   return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// Give each new local record a unique identifier and readable prefix.
function uid(prefix) { return prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)); }
// Named fields make the initial catalog easy to explain and edit. No positional database rows.
const INITIAL_PRODUCTS = [
  {id:'p01',name:'Everyday Wireless Headphones',category:'Electronics',price:1299,original:1899,stock:24,photo:'1505740420928-5e560c06d30e'},
  {id:'p02',name:'Cloud Everyday Sneakers',category:'Fashion',price:1499,original:2199,stock:18,photo:'1542291026-7eec264c27ff'},
  {id:'p03',name:'Daybreak Ceramic Mug',category:'Home & Living',price:289,original:399,stock:42,photo:'1514228742587-6b1558fcca3d'},
  {id:'p04',name:'Everywhere Canvas Tote',category:'Fashion',price:349,original:499,stock:32,photo:'1553062407-98eeb64c6a62'},
  {id:'p05',name:'Glow Daily Skincare Set',category:'Beauty',price:799,original:1199,stock:9,photo:'1556229010-6c3f2c9ca5f8'},
  {id:'p06',name:'Pocket Wireless Speaker',category:'Electronics',price:699,original:999,stock:27,photo:'1608043152269-423dbba4e7e1'},
  {id:'p07',name:'Studio Desk Lamp',category:'Home & Living',price:899,original:1399,stock:8,photo:'1507473885765-e6ed057f782c'},
  {id:'p08',name:'Move Insulated Bottle',category:'Sports & Outdoors',price:449,original:699,stock:36,photo:'1602143407151-7111542de6e8'},
  {id:'p09',name:'Sunday Cotton Tee',category:'Fashion',price:399,original:599,stock:54,photo:'1521572163474-6864f9cf17ab'},
  {id:'p10',name:'Focus Mechanical Keyboard',category:'Electronics',price:1899,original:2499,stock:14,photo:'1587829741301-dc798b83add3'},
  {id:'p11',name:'Soft Landing Cushion',category:'Home & Living',price:359,original:549,stock:22,photo:'1584100936595-c0654b55a2e2'},
  {id:'p12',name:'Weekend Adventure Pack',category:'Sports & Outdoors',price:1099,original:1599,stock:16,photo:'1622260614153-03223fb72052'},
  {id:'p13',name:'Little Green Desk Planter',category:'Home & Living',price:249,original:399,stock:31,photo:'1416879595882-3373a0480b5b'},
  {id:'p14',name:'Balance Yoga Mat',category:'Sports & Outdoors',price:599,original:899,stock:19,photo:'1544367567-0f2fcb009e0b'},
  {id:'p15',name:'Everyday Analog Watch',category:'Fashion',price:1199,original:1799,stock:12,photo:'1524805444758-089113d48a6d'}
];
// Accept direct internet photos; reject executable schemes and embedded credentials.
function normalizeImageSource(source) { try { const url = new URL(source);
   return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
// A built-in SVG keeps the five-file site presentable when a photo cannot load.
function fallbackImage(name = 'shopay') { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="430"><rect width="500" height="430" fill="#e5ecdf"/><circle cx="250" cy="195" r="113" fill="#d1ddc8"/><path d="M192 170h116l15 133H177l15-133m23 0v-25a35 35 0 0 1 70 0v25" fill="none" stroke="#708469" stroke-width="9"/><text x="250" y="365" text-anchor="middle" fill="#405c48" font-family="Georgia" font-size="22">${escapeHtml(name.slice(0,30))}</text></svg>`); }
// Use the seller image URL, a catalog photo, or the built-in offline fallback.
function getProductImage(product) { const image=normalizeImageSource(product.image);if(image)return image;
  const initial=INITIAL_PRODUCTS.find(p=>p.id===product.id);
  return initial?`https://images.unsplash.com/photo-${initial.photo}?w=640&auto=format&fit=crop&q=80`:fallbackImage(product.name); }
// Prepare the catalog, account, order history, and opening inventory.
function seed(now = new Date()) {
  const shopId = 'shopay-studio', expiry = new Date(now); expiry.setFullYear(expiry.getFullYear()+1);
  const products = INITIAL_PRODUCTS.map(p => ({...p,shopId,image:`https://images.unsplash.com/photo-${p.photo}?w=640&auto=format&fit=crop&q=80`,active:true,description:'A thoughtful everyday essential from the original Shopay collection.',specs:'Standard edition',supplier:'Shopay Supply Co.',lead:7,safety:10,minimum:5,flash:['p01','p03','p05'].includes(p.id),created:new Date(now.getFullYear(),now.getMonth()-7,1).toISOString()}));
  const users = [{id:'customer-demo',name:'Alex Reyes',email:'alex@shopay.ph',pin:'1234',role:'customer',addresses:['12 Acacia Street, Quezon City'],claimed:['HELLO10','SHIPFREE'],laterActive:true},{id:'seller-demo',name:'Jamie Santos',email:'seller@shopay.ph',pin:'1234',role:'seller',addresses:['Shopay Studio, Makati City'],claimed:[],laterActive:false}];
  const data = {version:1,seededAt:now.toISOString(),shop:{id:shopId,name:'Shopay Studio',tagline:'Good finds. Everyday joy.'},users,products,orders:[],carts:{},vouchers:[],installments:[],adjustments:[],reviews:[],settings:{standard:49,express:99,window:4}};
  for (let daysAgo = 181; daysAgo >= 1; daysAgo--) {
    const d = new Date(now); d.setDate(d.getDate()-daysAgo); d.setHours(12,0,0,0);
    const items = products.map((p,i) => { const qty = Math.max(0,Math.round((i<4?1.9:.7)+Math.sin((181-daysAgo)*.53+i*1.7)+(d.getDay()===6?.9:0)+(181-daysAgo)/400));
   return {productId:p.id,shopId,name:p.name,category:p.category,price:p.price,image:p.image,qty,net:p.price*qty}; }).filter(i => i.qty);
    const total = items.reduce((sum,i) => sum+i.net,0);
   data.orders.push({id:'SP-'+dateKey(d),userId:users[0].id,customer:users[0].name,shopId,date:d.toISOString(),completedAt:d.toISOString(),items,status:'Completed',subtotal:total,discount:0,shipping:0,shippingDiscount:0,total,payment:'E-Wallet',address:users[0].addresses[0],seeded:true});
  }
  data.vouchers = [{id:'v1',code:'HELLO10',type:'percent',value:10,min:500,max:250},{id:'v2',code:'SHIPFREE',type:'shipping',value:100,min:299,max:100},{id:'v3',code:'LITTLEJOY',type:'fixed',value:100,min:1200,max:100}].map(v => ({...v,shopId,expires:dateKey(expiry),remaining:100}));
  const loanDate = new Date(now); loanDate.setDate(loanDate.getDate()-20); const p = products[0];
  data.orders.push({id:'SP-LATER-001',userId:users[0].id,customer:users[0].name,shopId,date:loanDate.toISOString(),completedAt:loanDate.toISOString(),status:'Completed',items:[{productId:p.id,shopId,name:p.name,category:p.category,price:p.price,image:p.image,qty:1,net:1299}],subtotal:1299,discount:0,shipping:0,shippingDiscount:0,total:1299,payment:'ShopayLater',address:users[0].addresses[0],vouchers:[],seeded:true});
  data.installments.push({id:'SL-001',orderId:'SP-LATER-001',userId:users[0].id,principal:1299,remaining:866,months:3,monthly:433,payments:[{date:loanDate.toISOString(),amount:433}],date:loanDate.toISOString(),seeded:true});
  data.adjustments = products.map(p => ({id:'opening-'+p.id,productId:p.id,qty:p.stock+data.orders.reduce((n,o) => n+o.items.filter(i=>i.productId===p.id).reduce((sum,i)=>sum+i.qty,0),0),date:new Date(now.getTime()-182*86400000).toISOString(),reason:'Opening stock (sales deducted)'}));
  data.reviews = [{id:'r1',userId:users[0].id,productId:'p01',name:'Alex R.',rating:5,text:'Comfortable through a full day of use.',seeded:true}]; return data;
}
// Validate imported or changed records before any LocalStorage replacement.
function validate(data) {
  if (!data || data.version!==1 || !data.shop || !data.carts || !data.settings || !['users','products','orders','vouchers','installments','adjustments','reviews'].every(k=>Array.isArray(data[k]))) throw Error('Invalid Shopay backup structure.');
  if (data.users.filter(u=>u.role==='seller').length!==1 || new Set(data.users.map(u=>u.id)).size!==data.users.length) throw Error('Shop setup requires exactly one seller and unique accounts.');
  for (const u of data.users) if (!u.id || typeof u.name!=='string' || typeof u.email!=='string' || !/^\d{4}$/.test(u.pin) || !['seller','customer'].includes(u.role) || !Array.isArray(u.addresses) || !Array.isArray(u.claimed)) throw Error('Invalid account record.');
  if (new Set(data.products.map(p=>p.id)).size!==data.products.length) throw Error('Product IDs must be unique.');
  for (const p of data.products) if (!p.id || p.shopId!==data.shop.id || typeof p.name!=='string' || !Number.isFinite(p.price) || p.price<=0 || !Number.isFinite(p.original) || p.original<p.price || !['stock','lead','safety','minimum'].every(k=>Number.isInteger(p[k])&&p[k]>=0)) throw Error('Invalid product record.');
  for (const o of data.orders) if (!data.users.some(u=>u.id===o.userId) || !STATUSES[o.status] || !Number.isFinite(Date.parse(o.date)) || !Number.isFinite(o.total) || !Array.isArray(o.items) || !o.items.length || o.items.some(i=>i.shopId!==data.shop.id||!Number.isInteger(i.qty)||i.qty<1||!Number.isFinite(i.price)||!Number.isFinite(i.net))) throw Error('Invalid order record.');
  for (const v of data.vouchers) if (!/^[A-Za-z0-9_-]{3,30}$/.test(v.code) || !['percent','fixed','shipping'].includes(v.type) || !['value','min','max'].every(k=>Number.isFinite(v[k])&&v[k]>=0) || (v.type==='percent'&&v.value>100) || !Number.isInteger(v.remaining) || v.remaining<0 || !Number.isFinite(Date.parse(v.expires))) throw Error('Invalid voucher record.');
  for (const l of data.installments) if (!data.users.some(u=>u.id===l.userId) || ![1,3,6].includes(l.months) || !Number.isFinite(l.principal) || !Number.isFinite(l.remaining) || l.remaining<0 || l.remaining>l.principal || !(l.monthly>0) || !Array.isArray(l.payments)) throw Error('Invalid installment record.');
  for (const rows of Object.values(data.carts)) if (!Array.isArray(rows) || rows.some(i=>!data.products.some(p=>p.id===i.productId)||!Number.isInteger(i.qty)||i.qty<1||typeof i.selected!=='boolean')) throw Error('Invalid cart record.');
  for (const r of data.reviews) if (!Number.isInteger(r.rating)||r.rating<1||r.rating>5||typeof r.text!=='string'||typeof r.name!=='string') throw Error('Invalid review record.');
  if (!['standard','express'].every(k=>Number.isFinite(data.settings[k])&&data.settings[k]>=0) || !Number.isInteger(data.settings.window) || data.settings.window<2 || data.settings.window>12) throw Error('Invalid shop settings.'); return data;
}
function migrateShopCopy(data) {
  const emails={'alex@shopay.demo':'alex@shopay.ph','seller@shopay.demo':'seller@shopay.ph'};
  data.users.forEach(u=>{if(emails[u.email])u.email=emails[u.email];u.addresses=u.addresses.map(a=>typeof a==='string'?a.replace('12 Demo Lane, Sample Barangay, Quezon City','12 Acacia Street, Quezon City').replace('Shopay Studio, Demo City','Shopay Studio, Makati City'):a);});
  data.products.forEach(p=>{if(typeof p.description==='string')p.description=p.description.replace('original Shopay demo collection','original Shopay collection');if(typeof p.specs==='string')p.specs=p.specs.replace(' · Fictional demo product','');if(typeof p.supplier==='string')p.supplier=p.supplier.replace('Shopay Demo Supply Co.','Shopay Supply Co.');});
  data.orders.forEach(o=>{if(typeof o.id==='string')o.id=o.id.replace(/^DEMO-/,'SP-');if(typeof o.payment==='string')o.payment=o.payment.replace('Demo E-Wallet','E-Wallet').replace('Demo Card','Card');if(typeof o.address==='string')o.address=o.address.replace('12 Demo Lane, Sample Barangay, Quezon City','12 Acacia Street, Quezon City');});
  data.installments.forEach(l=>{if(typeof l.id==='string')l.id=l.id.replace('SL-DEMO-','SL-');if(typeof l.orderId==='string')l.orderId=l.orderId.replace(/^DEMO-/,'SP-');});
  [...data.orders,...data.installments,...data.reviews].forEach(record=>{if(record.seeded===undefined&&record.synthetic!==undefined)record.seeded=record.synthetic;delete record.synthetic;});
  data.adjustments.forEach(a=>{if(typeof a.reason==='string')a.reason=a.reason.replace('Synthetic opening stock','Opening stock');});
  data.reviews.forEach(r=>{if(r.text==='Comfortable for a long study session.')r.text='Comfortable through a full day of use.';});return data;
}
function load(storage) { const raw = storage.getItem(KEY); if (!raw) return null; try { return migrateShopCopy(validate(JSON.parse(raw)));
   } catch (error) { throw Error('Stored data could not be read. Export before resetting. '+error.message); } } // Preserve corrupt data for recovery.
function save(data, storage) { validate(data); try { storage.setItem(KEY,JSON.stringify(data));
   } catch { throw Error('Browser storage is full or unavailable. Export a backup.'); } } // One validated write.
function currentUser(data, id) { return data?.users.find(u=>u.id===id); } // Account lookup.
function getCurrentUser() { return currentUser(store,activeUserId); } // Current local session.
function cart(data, id) { return data.carts[id] || []; } // Account-specific cart rows.
// Zero removes even an inactive item; positive quantities must be whole and available.
function setCart(data, id, productId, qty) {
  if (!Number.isInteger(qty)||qty<0) throw Error('Enter a nonnegative whole quantity.');
  const rows = cart(data,id).filter(i=>i.productId!==productId); if (!qty) { data.carts[id]=rows; return; }
  const p = data.products.find(p=>p.id===productId&&p.active); if (!p) throw Error('This product is unavailable.');
   if(qty>p.stock) throw Error(`Only ${p.stock} units available.`);
  rows.push({productId,qty,selected:true}); data.carts[id]=rows;
}
// Validate eligibility and cap discounts; quoting never consumes voucher uses.
function voucher(data, code, subtotal, shipping, type) {
  if (!code) return {amount:0,record:null}; const v=data.vouchers.find(v=>v.code.toUpperCase()===code.trim().toUpperCase());
  if (!v) throw Error('Voucher not found.'); if(v.shopId&&v.shopId!==data.shop.id) throw Error('Voucher belongs to a different shop.');
  if ((v.type==='shipping')!==(type==='shipping')) throw Error('Use the matching voucher field.');
   if(v.expires<dateKey(new Date())||v.remaining<=0) throw Error('Voucher expired or fully used.');
   if(subtotal<v.min) throw Error(`Voucher requires a minimum spend of ${formatCurrency(v.min)}.`);
  const amount=v.type==='shipping'?Math.min(shipping,v.value,v.max):Math.min(subtotal,v.max,v.type==='percent'?subtotal*v.value/100:v.value);
   return {amount:money(amount),record:v};
}
// Price only selected items and recheck live stock before displaying or placing an order.
function quote(data, id, options={}) {
  const rows=cart(data,id).filter(i=>i.selected).map(i=>{const p=data.products.find(p=>p.id===i.productId);
   if(!p?.active||!Number.isInteger(i.qty)||i.qty<1||i.qty>p.stock) throw Error('An item is unavailable or exceeds stock.'); return {...p,qty:i.qty};});
  if (!rows.length) throw Error('Select at least one item for checkout.');
   const subtotal=money(rows.reduce((n,p)=>n+p.price*p.qty,0)), shipping=options.shipping==='express'?data.settings.express:data.settings.standard;
  const discount=voucher(data,options.code,subtotal,shipping,'order'), delivery=voucher(data,options.shippingCode,subtotal,shipping,'shipping');
  return {rows,subtotal,shipping,discount:discount.amount,shippingDiscount:delivery.amount,total:money(subtotal-discount.amount+shipping-delivery.amount),vouchers:[discount.record,delivery.record].filter(Boolean)};
}
function availableCredit(data,id) { return money(10000-data.installments.filter(l=>l.userId===id).reduce((n,l)=>n+l.remaining,0)); } // Subtract active installment balances.
// Validate first; then snapshot prices, reserve stock, consume vouchers, and clear selected lines.
function checkout(data, id, options) {
  const user=currentUser(data,id); if(!user) throw Error('Please log in.');
   if(!['Cash on Delivery','E-Wallet','Card','ShopayLater'].includes(options.payment)) throw Error('Select a payment method.');
  if(typeof options.address!=='string'||options.address.trim().length<8) throw Error('Enter a delivery address.');
   if(options.token&&data.orders.some(o=>o.token===options.token)) throw Error('This checkout has already been placed.');
  const q=quote(data,id,options); if(options.payment==='ShopayLater') { if(!user.laterActive) throw Error('Activate ShopayLater first.');
   if(![1,3,6].includes(+options.months)) throw Error('Choose 1, 3, or 6 months.');
   if(q.total>availableCredit(data,id)) throw Error('This order is above your available ShopayLater balance.'); }
  const order={id:uid('SP'),token:options.token,userId:id,customer:user.name,shopId:data.shop.id,date:new Date().toISOString(),completedAt:null,status:'Pending',address:options.address.trim(),payment:options.payment,shippingOption:options.shipping||'standard',subtotal:q.subtotal,discount:q.discount,shipping:q.shipping,shippingDiscount:q.shippingDiscount,total:q.total,vouchers:q.vouchers.map(v=>v.code),restored:false,seeded:false,items:[]}; let allocated=0;
  q.rows.forEach((p,index)=>{const line=p.price*p.qty, reduction=index===q.rows.length-1?money(q.discount-allocated):money(q.discount*line/q.subtotal);
   allocated=money(allocated+reduction);
   order.items.push({productId:p.id,shopId:p.shopId,name:p.name,category:p.category,price:p.price,qty:p.qty,image:p.image,net:money(line-reduction)});
   data.products.find(item=>item.id===p.id).stock-=p.qty;});
  q.vouchers.forEach(v=>v.remaining--); data.orders.push(order); data.carts[id]=cart(data,id).filter(i=>!i.selected);
  if(options.payment==='ShopayLater') data.installments.push({id:uid('SL'),orderId:order.id,userId:id,principal:q.total,remaining:q.total,months:+options.months,monthly:money(q.total/+options.months),payments:[],date:order.date}); return order;
}
// Only permitted transitions are accepted. Cancellation restores stock exactly once.
function updateOrderStatus(data,id,next) {
  const o=data.orders.find(o=>o.id===id); if(!o||!STATUSES[o.status].includes(next)) throw Error('Invalid order status transition.');
  if(next==='Canceled'&&!o.restored) { o.items.forEach(i=>{const p=data.products.find(p=>p.id===i.productId); if(p)p.stock+=i.qty;
  }); o.restored=true; const loan=data.installments.find(l=>l.orderId===id); if(loan){loan.remaining=0;loan.canceled=true;} }
  o.status=next; if(next==='Completed')o.completedAt=new Date().toISOString();
}
function repay(data,userId,id) { const l=data.installments.find(l=>l.id===id&&l.userId===userId); if(!l||l.remaining<=0)throw Error('No balance to repay.');
   const amount=money(l.payments.length>=l.months-1?l.remaining:Math.min(l.monthly,l.remaining)); l.remaining=money(l.remaining-amount);
   l.payments.push({date:new Date().toISOString(),amount}); return amount; } // Settle final rounding cents.
function restock(data,id,qty) { const p=data.products.find(p=>p.id===id); if(!p||!Number.isInteger(qty)||qty<=0)throw Error('Enter a positive whole quantity.');
   p.stock+=qty; data.adjustments.push({id:uid('ADJ'),productId:id,qty,date:new Date().toISOString(),reason:'Manual restock'}); } // Keep adjustment history.
// Group completed snapshots into consecutive complete periods; missing sales remain zero.
function series(data,productId,period='weekly',count=26,now=new Date()) {
  function periodStart(value) { const d=new Date(value); d.setHours(0,0,0,0);
   if(period==='weekly')d.setDate(d.getDate()-((d.getDay()+6)%7)); if(period==='monthly')d.setDate(1); return d; } // Calendar boundary.
  function shiftPeriod(value,offset) { const d=new Date(value); if(period==='monthly')d.setMonth(d.getMonth()+offset);
   else d.setDate(d.getDate()+offset*(period==='weekly'?7:1)); return d; } // Whole-period movement.
  const start=periodStart(now), buckets=Array.from({length:count},(_,i)=>({date:dateKey(shiftPeriod(start,i-count)),end:dateKey(shiftPeriod(start,i-count+1)),units:0,revenue:0,orders:0})), lookup=new Map(buckets.map(b=>[b.date,b]));
  data.orders.filter(o=>o.shopId===data.shop.id&&o.status==='Completed').forEach(o=>{const b=lookup.get(dateKey(periodStart(o.completedAt||o.date))); if(!b)return;
   const items=o.items.filter(i=>!productId||i.productId===productId); items.forEach(i=>{b.units+=i.qty;
  b.revenue=money(b.revenue+i.net);}); if(items.length)b.orders++;}); return buckets;
}
function predict(values,windowSize=4) { if(values.length<windowSize)return null;
   return values.slice(-windowSize).reduce((sum,value)=>sum+value,0)/windowSize; } // SMA = sum / number of periods.
// Rolling holdouts use earlier observations only. Zero actuals are excluded from MAPE.
function forecast(data,id,windowSize=data.settings.window,now=new Date()) {
  const history=series(data,id,'weekly',26,now), values=history.map(b=>b.units), errors=[];
  for(let i=Math.max(windowSize,values.length-8);i<values.length;i++){const predicted=predict(values.slice(0,i),windowSize);
  errors.push({actual:values[i],predicted,error:Math.abs(values[i]-predicted)});}
  const nonzero=errors.filter(e=>e.actual!==0);
   return {history,future:predict(values,windowSize),errors,mad:errors.length?errors.reduce((n,e)=>n+e.error,0)/errors.length:null,mape:nonzero.length?100*nonzero.reduce((n,e)=>n+e.error/e.actual,0)/nonzero.length:null,zeroSkipped:errors.length-nonzero.length};
}
function replenishment(product,weeklyDemand) { const daily=weeklyDemand/7, rop=ceilUnits(daily*product.lead+product.safety), target=ceilUnits(daily*(product.lead+14)+product.safety);
   return {weekly:weeklyDemand,daily,rop,target,reorder:product.stock<=rop?Math.max(0,target-product.stock):0,low:product.stock<=Math.max(rop,product.minimum)}; } // One shared stock policy.
function inventory(data,product) { return replenishment(product,predict(series(data,product.id,'weekly',data.settings.window).map(b=>b.units),data.settings.window));
   } // Avoid accuracy work for stock alerts.
function metrics(data,days=30,offset=0,now=new Date()) { const end=new Date(now);end.setHours(23,59,59,999);
  end.setDate(end.getDate()-offset);const start=new Date(end);start.setDate(start.getDate()-days+1);start.setHours(0,0,0,0);
  const orders=data.orders.filter(o=>o.shopId===data.shop.id&&o.status==='Completed'&&new Date(o.completedAt||o.date)>=start&&new Date(o.completedAt||o.date)<=end), units=orders.reduce((n,o)=>n+o.items.reduce((sum,i)=>sum+i.qty,0),0), revenue=money(orders.reduce((n,o)=>n+o.items.reduce((sum,i)=>sum+i.net,0),0));
  return {orders,units,revenue,aov:orders.length?money(revenue/orders.length):0}; } // Discounts included; delivery excluded.
// Publish the original calculation API for the seller page and regression verification.
window.Shopay={KEY,money,ceilUnits,dateKey,uid,normalizeImageSource,validate,load,save,currentUser,cart,setCart,voucher,quote,availableCredit,checkout,status:updateOrderStatus,repay,restock,series,predict,forecast,inventory,replenishment,metrics};
/* CUSTOMER CONTROLLER: functions below read the HTML rather than generate whole pages. */
function showToast(message) { const el=byId('toast');el.textContent=message;el.classList.add('show');
  clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),4200); } // Accessible feedback.
function updateState(change) { const next=structuredClone(store), result=change(next);
  save(next,localStorage);store=next;return result; } // Publish only after a successful write.
function requireUser() { if(getCurrentUser())return true;location.hash='login';return false; } // Protect customer records.
function renderStatusBadge(value) { return `<span class="badge ${escapeHtml(value.toLowerCase())}">${escapeHtml(value)}</span>`; } // Consistent statuses.
// Give an empty list a useful message and a route back to shopping.
function renderEmptyState(message) { return `<div class="empty">
    <span>✦</span><h2>${escapeHtml(message)}</h2><a href="#home">Explore the good finds ↗</a></div>`; }
// Cache once per saved state, avoiding repeated historical scans for cards and sorting.
function getUnitsSold(id) {
  if(soldCacheState!==store){soldCache=new Map();store.orders.filter(o=>o.status==='Completed').forEach(o=>o.items.forEach(i=>soldCache.set(i.productId,(soldCache.get(i.productId)||0)+i.qty)));soldCacheState=store;}
  return soldCache.get(id)||0;
}
// Show an average only when the product has actual saved reviews.
function renderRating(id) { const rows=store.reviews.filter(r=>r.productId===id);
  return rows.length?`<span class="rating">★ ${(rows.reduce((n,r)=>n+r.rating,0)/rows.length).toFixed(1)}</span>`:''; }
// Small repeated cards are the only customer markup built in JavaScript.
function renderProductCard(p) { return `<article class="product-card"><a href="#product/${escapeHtml(p.id)}" class="product-art">
    <img loading="lazy" decoding="async" src="${escapeHtml(getProductImage(p))}" alt="${escapeHtml(p.name)}">
    <span class="discount">−${Math.round((1-p.price/p.original)*100)}%</span>${p.stock?'':'<b class="sold-out">Sold out</b>'}</a>
    <div class="product-copy"><small>${escapeHtml(p.category)}</small><a href="#product/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a>
    <div class="prices"><strong>${formatCurrency(p.price)}</strong><s>${formatCurrency(p.original)}</s></div>
    <div class="product-meta">${renderRating(p.id)}<span>${getUnitsSold(p.id)} sold</span><button data-action="add" data-id="${escapeHtml(p.id)}" aria-label="Add ${escapeHtml(p.name)}" ${p.stock?'':'disabled'}>+</button></div>
    <small>${escapeHtml(store.shop.name)}</small></div></article>`; }
// Filter and sort active products, then refresh the homepage cards and offers.
function renderHomePage() {
  const search=byId('search-form').elements.search.value.trim().toLowerCase(), min=+byId('min-price').value, max=+byId('max-price').value, sort=byId('sort').value;
  let products=store.products.filter(p=>p.active&&(category==='All'||p.category===category)&&p.name.toLowerCase().includes(search)&&p.price>=min&&(!max||p.price<=max)&&(!byId('available-only').checked||p.stock>0));
  if(sort==='low')products.sort((a,b)=>a.price-b.price);if(sort==='high')products.sort((a,b)=>b.price-a.price);
  if(sort==='sold')products.sort((a,b)=>getUnitsSold(b.id)-getUnitsSold(a.id));if(sort==='new')products.sort((a,b)=>new Date(b.created)-new Date(a.created));
  byId('product-grid').innerHTML=products.map(renderProductCard).join('')||renderEmptyState('No finds match these filters.');
  byId('product-count').textContent=`${products.length} good finds`;
  byId('category-buttons').innerHTML=['All',...CATEGORIES].map(c=>`<button data-action="category" data-value="${c}" class="${c===category?'active':''}">${c}</button>`).join('');
  const hero=store.products.find(p=>p.active)||INITIAL_PRODUCTS[0];byId('hero-image').src=getProductImage(hero);
  byId('hero-name').textContent=hero.name;byId('hero-price').textContent=formatCurrency(hero.price);
  byId('flash-products').innerHTML=store.products.filter(p=>p.active&&p.flash).slice(0,3).map(p=>`<a href="#product/${p.id}">
    <img src="${escapeHtml(getProductImage(p))}" alt="${escapeHtml(p.name)}"><strong>${formatCurrency(p.price)}</strong></a>`).join('');
}
// Fill one product detail view and check whether the account may post a review.
function renderProductPage(id) {
  const p=store.products.find(p=>p.id===id&&p.active);if(!p){location.hash='home';return;}selectedProductId=id;
  for(const [element,value]of Object.entries({'detail-name':p.name,'detail-category':p.category,'detail-description':p.description,'detail-specs':p.specs,'detail-stock':`${p.stock} available`,'detail-shop':store.shop.name}))byId(element).textContent=value;
  byId('detail-image').src=getProductImage(p);byId('detail-image').alt=p.name;
  byId('detail-price').innerHTML=`<strong>${formatCurrency(p.price)}</strong><s>${formatCurrency(p.original)}</s>
    <span>Save ${Math.round((1-p.price/p.original)*100)}%</span>`;byId('detail-rating').innerHTML=renderRating(id)+` · ${getUnitsSold(id)} completed units sold`;
  byId('product-qty').value=p.stock?1:0;byId('product-qty').max=p.stock;
  document.querySelectorAll('#page-product .button-row button').forEach(b=>b.disabled=!p.stock);
  const reviews=store.reviews.filter(r=>r.productId===id);
  byId('reviews').innerHTML=reviews.map(r=>`<div class="review"><strong>${escapeHtml(r.name)} <span class="rating">${'★'.repeat(r.rating)}</span></strong>
    <p>${escapeHtml(r.text)}</p></div>`).join('')||'<p class="muted">No reviews yet.</p>';
  byId('review-form').hidden=!getCurrentUser()||!store.orders.some(o=>o.userId===activeUserId&&o.status==='Completed'&&o.items.some(i=>i.productId===id))||reviews.some(r=>r.userId===activeUserId&&!r.seeded);
}
// Render cart quantities and totals for checked items only.
function renderCartPage() { const rows=cart(store,activeUserId);byId('cart-items').innerHTML=rows.map(i=>{const p=store.products.find(p=>p.id===i.productId);
  return `<div class="cart-item"><input type="checkbox" data-select="${p.id}" ${i.selected?'checked':''} aria-label="Select ${escapeHtml(p.name)}">
    <img src="${escapeHtml(getProductImage(p))}" alt="">
    <div><strong>${escapeHtml(p.name)}</strong>
    <small>${p.stock} available</small><button data-action="remove" data-id="${p.id}" class="text-button">Remove</button></div><input type="number" min="1" max="${p.stock}" value="${i.qty}" data-quantity="${p.id}" aria-label="Quantity for ${escapeHtml(p.name)}"><b>${formatCurrency(i.qty*p.price)}</b></div>`;
  }).join('')||renderEmptyState('Your bag is waiting for a good find.');
  const subtotal=rows.filter(i=>i.selected).reduce((n,i)=>n+i.qty*store.products.find(p=>p.id===i.productId).price,0);
  byId('cart-summary').innerHTML=summaryLine('Selected items',rows.filter(i=>i.selected).reduce((n,i)=>n+i.qty,0))+summaryLine('Subtotal',formatCurrency(subtotal))+summaryLine('Delivery from',formatCurrency(store.settings.standard))+summaryLine('Estimated total',formatCurrency(subtotal+store.settings.standard)); }
function summaryLine(label,value) { return `<div class="summary-line">
    <span>${escapeHtml(label)}</span><strong>${value}</strong></div>`; } // Shared totals layout.
function readCheckoutOptions() { return {...Object.fromEntries(new FormData(byId('checkout-form'))),token:checkoutToken}; } // Read visible choices.
// Display quoted lines, capped discounts, delivery, and optional monthly payments.
function renderOrderSummary(q,options={}) { return q.rows.map(p=>summaryLine(p.name+' ×'+p.qty,formatCurrency(p.price*p.qty))).join('')+'<hr>'+summaryLine('Subtotal',formatCurrency(q.subtotal))+summaryLine('Order discount','−'+formatCurrency(q.discount))+summaryLine('Delivery',formatCurrency(q.shipping))+summaryLine('Shipping discount','−'+formatCurrency(q.shippingDiscount))+summaryLine('Total payable',formatCurrency(q.total))+(options.payment==='ShopayLater'?`<p class="notice">${formatCurrency(q.total/(+options.months||3))} × ${options.months||3} months · Zero fees. Final payment adjusts cents.</p>`:''); }
function updateCheckoutSummary() { const options=readCheckoutOptions();byId('installment-options').hidden=options.payment!=='ShopayLater';
  try{byId('checkout-summary').innerHTML=renderOrderSummary(quote(store,activeUserId,options),options);byId('place-order').disabled=false;
  }catch(error){byId('checkout-summary').textContent=error.message;byId('place-order').disabled=true;} }
// Prepare the saved address, delivery fees, credit balance, and checkout token.
function renderCheckoutPage() { checkoutToken=uid('checkout');byId('checkout-form').elements.address.value=getCurrentUser().addresses[0]||'';
  byId('shipping-option').innerHTML=`<option value="standard">Standard — ${formatCurrency(store.settings.standard)}</option><option value="express">Express — ${formatCurrency(store.settings.express)}</option>`;
  byId('credit-message').textContent=getCurrentUser().laterActive?`${formatCurrency(availableCredit(store,activeUserId))} available ShopayLater balance`:'Activate ShopayLater in your account first.';updateCheckoutSummary(); }
// Order cards use immutable snapshots; later catalog changes do not rewrite past purchases.
function renderOrderCard(o) { return `<article class="panel order-card"><div class="section-heading"><div><strong>${escapeHtml(o.id.slice(0,22))}</strong>
    <small>${formatDate(o.date)} · ${escapeHtml(o.payment)}</small></div>${renderStatusBadge(o.status)}</div>${o.items.map(i=>`<div class="order-line">
    <img src="${escapeHtml(getProductImage({...i,id:i.productId}))}" alt="">
    <span>${escapeHtml(i.name)} ×${i.qty}</span><b>${formatCurrency(i.net)}</b></div>`).join('')}<p class="order-progress">${['Pending','Processing','Shipped','Delivered','Completed'].map(s=>`<span class="${Object.keys(STATUSES).indexOf(s)<=Object.keys(STATUSES).indexOf(o.status)&&o.status!=='Canceled'?'done':''}">${s}</span>`).join(' → ')}</p>
    <p class="muted small">${escapeHtml(o.address)}</p>${summaryLine('Total payable',formatCurrency(o.total))}${['Pending','Processing'].includes(o.status)&&o.userId===activeUserId?`<button data-action="cancel-order" data-id="${o.id}" class="text-button">Cancel order</button>`:''}</article>`; }
// Show recent purchases and include earlier history when requested.
function renderOrdersPage() { const orders=store.orders.filter(o=>o.userId===activeUserId&&(!o.seeded||byId('show-earlier-orders').checked)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  byId('order-list').innerHTML=orders.slice(0,40).map(renderOrderCard).join('')||renderEmptyState('Your next delivery starts with a find.'); }
// Display eligibility information and the account claim state.
function renderVouchersPage() { byId('voucher-list').innerHTML=store.vouchers.map(v=>{const claimed=getCurrentUser()?.claimed.includes(v.code),disabled=v.remaining<=0||v.expires<dateKey(new Date());
  return `<article class="voucher-card"><div><strong>${v.type==='percent'?v.value+'%':formatCurrency(v.value)}</strong>
    <small>${v.type==='shipping'?'SHIPPING OFF':'OFF YOUR FINDS'}</small></div>
    <section><h2>${escapeHtml(v.code)}</h2><p>Min. ${formatCurrency(v.min)} · Cap ${formatCurrency(v.max)}</p>
    <small>Until ${formatDate(v.expires+'T12:00:00')} · ${v.remaining} uses left</small><button data-action="claim" data-id="${v.id}" class="button outlined small" ${disabled||claimed?'disabled':''}>${disabled?'Unavailable':claimed?'Claimed ✓':'Claim voucher'}</button></section></article>`;}).join(''); }
// Display the ShopayLater balance, plan details, and payment history.
function renderInstallmentsPage() { const user=getCurrentUser();
  byId('available-credit').textContent=formatCurrency(availableCredit(store,activeUserId));byId('activate-later').disabled=user.laterActive;
  byId('activate-later').textContent=user.laterActive?'ShopayLater active':'Activate ShopayLater';
  byId('installment-list').innerHTML=store.installments.filter(l=>l.userId===activeUserId).map(l=>`<article class="panel loan-card">
    <div><strong>${escapeHtml(l.orderId.slice(0,22))}</strong>
    <p>${l.months} months · Purchase ${formatCurrency(l.principal)} · ${formatCurrency(l.monthly)}/month · Total ${formatCurrency(l.principal)} · Zero fees</p><details><summary>${l.payments.length} payments</summary>${l.payments.map(p=>`<p>${formatDate(p.date)} · ${formatCurrency(p.amount)}</p>`).join('')}</details></div>
    <div><h2>${formatCurrency(l.remaining)}</h2>
    <small>Remaining balance</small><button data-action="repay" data-id="${l.id}" class="button primary small" ${l.remaining<=0?'disabled':''}>${l.canceled?'Canceled':l.remaining?'Simulate repayment':'Paid in full'}</button></div></article>`).join('')||renderEmptyState('No installment plans yet.'); }
// Fill the saved account details and delivery addresses.
function renderProfilePage() { const u=getCurrentUser(),form=byId('profile-form');
  byId('profile-greeting').textContent=`Hello, ${u.name.split(' ')[0]}.`;form.elements.name.value=u.name;form.elements.email.value=u.email;
  byId('address-list').innerHTML=u.addresses.map((address,i)=>`<p class="address-row">${escapeHtml(address)} <button data-action="remove-address" data-id="${i}" class="text-button">Remove</button></p>`).join(''); }
// Select a customer section, protect private views, and leave the static HTML in place.
function renderApplication() {
  if(document.body.dataset.mode==='admin'){if(typeof initializeAdmin==='function')initializeAdmin();return;}
  const route=location.hash.slice(1)||'home',page=route.startsWith('product/')?'product':route==='collection'?'home':route;
  if(!['home','product','vouchers','login','register','backup'].includes(page)&&!requireUser())return;
  document.querySelectorAll('main > .page').forEach(el=>el.hidden=el.id!=='page-'+page);
  byId('cart-count').textContent=getCurrentUser()?cart(store,activeUserId).reduce((n,i)=>n+i.qty,0):0;
  byId('account-link').textContent=getCurrentUser()?.name.split(' ')[0]||'Log in';
  const activeRoute=page==='checkout'?'cart':page==='later'||page==='backup'?'profile':page;
  document.querySelectorAll('.site-header nav a').forEach(a=>{if(a.hash==='#'+activeRoute)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const views={home:renderHomePage,cart:renderCartPage,checkout:renderCheckoutPage,orders:renderOrdersPage,vouchers:renderVouchersPage,later:renderInstallmentsPage,profile:renderProfilePage};
  if(page==='product')renderProductPage(route.split('/')[1]);else if(views[page])views[page]();else if(!byId('page-'+page)){location.hash='home';return;}
  document.title='Shopay · '+(page==='home'?'Good finds, everyday':page);if(route==='collection')byId('collection').scrollIntoView();else window.scrollTo(0,0);
}
// Backups are JSON strings, not uploaded data. Import/reset require an explicit confirmation.
function exportBackup(raw=false) { const text=raw?localStorage.getItem(KEY):JSON.stringify(store,null,2),url=URL.createObjectURL(new Blob([text||''],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=`shopay-${dateKey(new Date())}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function importBackup(file) { if(!file)return;
  if(file.size>5*1024*1024)throw Error('Backup must be under 5 MB.');const data=migrateShopCopy(validate(JSON.parse(await file.text())));
  if(!confirm(`Replace local data with ${data.products.length} products and ${data.orders.length} orders? Export first to keep your current records.`))return;
  save(data,localStorage);store=data;activeUserId=null;localStorage.removeItem(SESSION_KEY);showToast('Backup restored. Please log in.');renderApplication(); }
// Replace local records only after confirmation; never reset data on refresh.
function resetShopData() { if(!confirm('Restore Shopay defaults? Export a backup first to keep your current data.'))return;
  const data=seed();save(data,localStorage);store=data;activeUserId=null;localStorage.removeItem(SESSION_KEY);location.reload(); }
// A single delegated listener covers new cards and refreshed rows without repeated listeners.
function handleDocumentClick(event) {
  const link=event.target.closest('a[href]'); if(link?.getAttribute('href').startsWith('#') && link.hash===location.hash){event.preventDefault();renderApplication();return;}
  const b=event.target.closest('[data-action]');if(!b)return;const {action,id,value}=b.dataset;
  try {
    if(action==='export'){exportBackup();return;}if(action==='reset'){resetShopData();return;}
    if(action==='logout'){activeUserId=null;localStorage.removeItem(SESSION_KEY);showToast('Logged out.');renderApplication();return;}
    if(action==='category'){category=value;location.hash='home';renderHomePage();byId('collection').scrollIntoView();return;}
    if(action==='clear-filters'){category='All';byId('search-form').reset();byId('min-price').value='';
  byId('max-price').value='';byId('available-only').checked=false;byId('sort').value='recommended';renderHomePage();return;}
    if(action==='apply-vouchers'){updateCheckoutSummary();return;}if(!requireUser())return;
    if(['add','add-detail','buy'].includes(action)){const productId=id||selectedProductId,qty=action==='add'?1:+byId('product-qty').value;
  updateState(data=>{setCart(data,activeUserId,productId,action==='buy'?qty:(cart(data,activeUserId).find(i=>i.productId===productId)?.qty||0)+qty);
  if(action==='buy')data.carts[activeUserId].forEach(i=>i.selected=i.productId===productId);});
  if(action==='buy')location.hash='checkout';else{renderApplication();showToast('A good find added to your bag.');}return;}
    if(action==='remove')updateState(data=>setCart(data,activeUserId,id,0));
    if(action==='cancel-order'){const o=store.orders.find(o=>o.id===id);if(o.userId!==activeUserId)throw Error('This order belongs to another account.');
  updateState(data=>updateOrderStatus(data,id,'Canceled'));showToast('Canceled; reserved stock restored.');}
    if(action==='claim')updateState(data=>{const v=data.vouchers.find(v=>v.id===id),u=currentUser(data,activeUserId);
  if(v.remaining<=0||v.expires<dateKey(new Date()))throw Error('Offer unavailable.');if(!u.claimed.includes(v.code))u.claimed.push(v.code);});
    if(action==='activate-later')updateState(data=>currentUser(data,activeUserId).laterActive=true);
    if(action==='repay'){const paid=updateState(data=>repay(data,activeUserId,id));showToast(`${formatCurrency(paid)} payment recorded.`);}
    if(action==='remove-address')updateState(data=>currentUser(data,activeUserId).addresses.splice(+id,1));renderApplication();
  } catch(error){showToast(error.message);}
}
// Native form constraints validate inputs; business rules are checked again before storage writes.
function handleFormSubmit(event) {
  const form=event.target;if(!['login-form','register-form','search-form','checkout-form','profile-form','address-form','review-form'].includes(form.id))return;
  event.preventDefault();const d=Object.fromEntries(new FormData(form));
  try {
    if(form.id==='search-form'){location.hash='home';renderHomePage();byId('collection').scrollIntoView();return;}
    if(form.id==='login-form'){const role=document.body.dataset.mode==='admin'?'seller':'customer',u=store.users.find(u=>u.role===role&&u.email.toLowerCase()===d.email.trim().toLowerCase()&&u.pin===d.pin);
  if(!u)throw Error('Check your email, PIN, and account type.');activeUserId=u.id;
  localStorage.setItem(SESSION_KEY,u.id);location.hash=role==='seller'?'dashboard':'home';renderApplication();return;}
    if(form.id==='register-form'){if(store.users.some(u=>u.email.toLowerCase()===d.email.trim().toLowerCase()))throw Error('This email is already registered.');
  if(!/^\d{4}$/.test(d.pin)||!d.name.trim())throw Error('Enter your name and a 4-digit PIN.');const id=uid('customer');
  updateState(data=>data.users.push({id,name:d.name.trim(),email:d.email.trim().toLowerCase(),pin:d.pin,role:'customer',addresses:[],claimed:[],laterActive:false}));
  activeUserId=id;localStorage.setItem(SESSION_KEY,id);location.hash='home';renderApplication();return;}
    if(!requireUser())return;
    if(form.id==='checkout-form'){byId('place-order').disabled=true;try{updateState(data=>checkout(data,activeUserId,{...d,token:checkoutToken}));
  location.hash='orders';showToast('Your order has been placed.');}finally{byId('place-order').disabled=false;}return;}
    if(form.id==='profile-form')updateState(data=>{if(!d.name.trim()||data.users.some(u=>u.id!==activeUserId&&u.email.toLowerCase()===d.email.trim().toLowerCase()))throw Error('Enter your name and a unique email address.');
  Object.assign(currentUser(data,activeUserId),{name:d.name.trim(),email:d.email.trim().toLowerCase()});});
    if(form.id==='address-form'){updateState(data=>currentUser(data,activeUserId).addresses.push(d.address.trim()));form.reset();}
    if(form.id==='review-form'){if(!d.text.trim()||!store.orders.some(o=>o.userId===activeUserId&&o.status==='Completed'&&o.items.some(i=>i.productId===selectedProductId))||store.reviews.some(r=>r.userId===activeUserId&&r.productId===selectedProductId&&!r.seeded))throw Error('Write one review per completed product purchase.');
  updateState(data=>data.reviews.push({id:uid('review'),userId:activeUserId,productId:selectedProductId,rating:+d.rating,text:d.text.trim(),name:getCurrentUser().name,seeded:false}));
  form.reset();}renderApplication();showToast('Your changes have been saved.');
  } catch(error){showToast(error.message);}
}
async function handleInputChange(event) { const el=event.target;try{if(el.id==='import-file'){await importBackup(el.files[0]);
  el.value='';return;}if(el.dataset.quantity){updateState(data=>setCart(data,activeUserId,el.dataset.quantity,+el.value));
  renderCartPage();}else if(el.dataset.select){updateState(data=>cart(data,activeUserId).find(i=>i.productId===el.dataset.select).selected=el.checked);
  renderCartPage();}else if(el.closest('#checkout-form'))updateCheckoutSummary();
  else if(['min-price','max-price','available-only','sort'].includes(el.id))renderHomePage();
  else if(el.id==='show-earlier-orders')renderOrdersPage();}catch(error){showToast(error.message);
  if(el.dataset.quantity)renderCartPage();} } // Refresh dependent totals after a change.
function handleProductImageError(event) { const img=event.target;if(img.tagName!=='IMG'||img.dataset.fallback)return;
  img.dataset.fallback='1';img.src=fallbackImage(img.alt||'shopay'); } // Offline/broken-photo fallback.
function handleStorageChange(event) { if([KEY,SESSION_KEY].includes(event.key)){try{store=load(localStorage);
  activeUserId=localStorage.getItem(SESSION_KEY);renderApplication();}catch(error){showToast(error.message);}} } // Reflect other tabs.
// Initialize once. A corrupt dataset is never silently replaced or seeded over.
function initializeShopay() {
  history.scrollRestoration='manual'; // Page routes control their own scroll position.
  try{store=load(localStorage);if(!store){store=seed();save(store,localStorage);}activeUserId=localStorage.getItem(SESSION_KEY);
  }catch(error){document.body.innerHTML=`<main class="page panel"><h1>Your Shopay data needs attention.</h1>
    <p>${escapeHtml(error.message)}</p><button id="raw-export" class="button outlined">Export stored data</button><button id="raw-reset" class="button danger">Restore shop defaults</button></main>`;
  byId('raw-export').onclick=()=>exportBackup(true);byId('raw-reset').onclick=resetShopData;return;}
  document.addEventListener('click',handleDocumentClick);document.addEventListener('submit',handleFormSubmit);
  document.addEventListener('change',handleInputChange);document.addEventListener('error',handleProductImageError,true);
  window.addEventListener('hashchange',renderApplication);window.addEventListener('storage',handleStorageChange);renderApplication();
}
document.addEventListener('DOMContentLoaded',initializeShopay,{once:true});




