/* SELLER STUDIO: this file only prepares seller views and handles seller forms.
   All storage, checkout, forecasting, and stock formulas are shared from script.js.
   Sales are recognized only at Completed; the current partial week is not forecast history. */
'use strict';
let inventoryCacheState, inventoryCacheDay = '', inventoryCache = new Map();
// Seller pages share one store, but only show records owned by the signed-in seller.
function sellerId() { return getCurrentUser()?.id||''; }
function sellerProducts() { return store.products.filter(p=>p.sellerId===sellerId()); }
function sellerOrder(o) { return o.items.some(i=>i.sellerId===sellerId()); }
// Cache recommendations until data or the calendar date changes.
function getInventorySummary(product) {
  const today=dateKey(new Date());if(inventoryCacheState!==store||inventoryCacheDay!==today){inventoryCacheState=store;
  inventoryCacheDay=today;inventoryCache=new Map();}
  if(!inventoryCache.has(product.id))inventoryCache.set(product.id,inventory(store,product));return inventoryCache.get(product.id);
}
function actionButton(label,action,id='') { return `<button class="text-button" data-admin="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`; } // Safe repeated table actions.
function renderKpiCard(title,value,subtitle) { return `<article class="kpi">
    <span>${escapeHtml(title)}</span><strong>${value}</strong><small>${subtitle}</small></article>`; } // One consistent metric card.
// Compare a metric with the previous period; handle a zero baseline explicitly.
function renderPeriodChange(value,previous) { return previous?`<span class="${value>=previous?'green':'coral'}">${value>=previous?'+':''}${formatNumber((value-previous)/previous*100)}%</span> vs preceding period`:'No previous-period comparison'; }
// Reuse the same four metrics on the overview and sales analytics pages.
function renderKpis(current,previous) { return renderKpiCard('Net product revenue',formatCurrency(current.revenue),renderPeriodChange(current.revenue,previous.revenue))+renderKpiCard('Completed orders',current.orders.length,renderPeriodChange(current.orders.length,previous.orders.length))+renderKpiCard('Units sold',current.units,renderPeriodChange(current.units,previous.units))+renderKpiCard('Average order value',formatCurrency(current.aov),renderPeriodChange(current.aov,previous.aov))+renderKpiCard('Shop visits',current.visits,renderPeriodChange(current.visits,previous.visits))+renderKpiCard('Reviews received',current.reviews,renderPeriodChange(current.reviews,previous.reviews)); }
// Map recorded values to SVG coordinates; no chart library or random values are needed.
function renderChart(data,key='revenue',future=null) {
  if(!data.some(d=>d.orders))return '<p>No completed sales recorded yet.</p>';
  const width=760,height=250,padding=40,count=data.length+(future===null?0:1),maximum=Math.max(1,...data.map(d=>d[key]),future||0)*1.15;
  function xPosition(index) { return padding+index*(width-padding-18)/Math.max(1,count-1); } // Period → horizontal position.
  function yPosition(value) { return height-padding-value/maximum*(height-padding-18); } // Quantity → vertical position.
  const points=data.map((d,i)=>`${xPosition(i)},${yPosition(d[key])}`).join(' ');
  const grid=Array.from({length:5},(_,i)=>{const value=maximum*i/4,y=yPosition(value);
  return `<line x1="${padding}" x2="${width-12}" y1="${y}" y2="${y}" stroke="#e7ebe1"/><text x="${padding-7}" y="${y+4}" text-anchor="end">${value>=1000?formatNumber(value/1000)+'k':formatNumber(value)}</text>`;}).join('');
  const labels=data.map((d,i)=>i%Math.max(1,Math.floor(data.length/6))===0?`<text x="${xPosition(i)}" y="${height-10}" text-anchor="${i?'middle':'start'}">${new Date(d.date+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</text>`:'').join('');
  const dots=data.map((d,i)=>`<circle cx="${xPosition(i)}" cy="${yPosition(d[key])}" r="3" fill="#355f49"><title>${d.date}: ${formatNumber(d[key])}</title></circle>`).join('');
  const prediction=future===null?'':`<line x1="${xPosition(data.length-1)}" y1="${yPosition(data.at(-1)[key])}" x2="${xPosition(data.length)}" y2="${yPosition(future)}" stroke="#e77b5b" stroke-width="3" stroke-dasharray="5 5"/><circle cx="${xPosition(data.length)}" cy="${yPosition(future)}" r="5" fill="#e77b5b"/><text x="${xPosition(data.length)-4}" y="${yPosition(future)-12}" text-anchor="end">${formatNumber(future)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${key==='revenue'?'Revenue in pesos':'Units sold'} across ${data.length} complete periods${future===null?'':'; next week forecast '+formatNumber(future)+' units'}">${grid}<polyline points="${points}" fill="none" stroke="#355f49" stroke-width="3" stroke-linejoin="round"/>${dots}${prediction}${labels}</svg>`;
}
// Rank completed item snapshots by product or category and show both units and revenue.
function renderRankingBars(orders,groupByCategory=false) {
  const groups={};orders.forEach(o=>o.items.forEach(i=>{const key=groupByCategory?i.category:i.productId;
  groups[key]??={name:groupByCategory?i.category:i.name,units:0,revenue:0};groups[key].units+=i.qty;groups[key].revenue+=i.net;}));
  const rows=Object.values(groups).sort((a,b)=>b.units-a.units).slice(0,5),maximum=Math.max(1,...rows.map(r=>r.units));
  return rows.map((r,i)=>`<div class="bar-row"><div><span>${i+1}. ${escapeHtml(r.name)}</span><b>${r.units} units</b></div>
    <div class="bar-track"><i style="width:${r.units/maximum*100}%"></i></div>
    <small>${formatCurrency(r.revenue)} net product revenue</small></div>`).join('')||'<p class="muted">No completed sales in this period.</p>';
}
// Select the seller section only after a valid seller login.
function initializeAdmin() {
  const allowed=getCurrentUser()?.role==='seller';byId('seller-login').hidden=allowed;byId('seller-app').hidden=!allowed;if(!allowed)return;
  const section=location.hash.slice(1)||'dashboard',valid=['dashboard','products','orders','messages','inventory','analytics','forecast','vouchers','settings'],page=valid.includes(section)?section:'dashboard';
  document.querySelectorAll('.admin-page').forEach(el=>el.hidden=el.id!=='page-'+page);
  document.querySelectorAll('.sidebar nav a').forEach(link=>link.classList.toggle('active',link.hash==='#'+page));
  byId('sidebar-shop').textContent=getCurrentUser().name;byId('workspace-label').textContent=getCurrentUser().isDemo?'DEMO SELLER':'SELLER ACCOUNT';byId('workspace-name').textContent=page==='dashboard'?'Overview':page[0].toUpperCase()+page.slice(1);
  byId('seller-greeting').textContent=`Good day, ${getCurrentUser().name.split(' ')[0]}.`;
  const selected=byId('forecast-product').value;
  byId('forecast-product').innerHTML=sellerProducts().map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  if(sellerProducts().some(p=>p.id===selected))byId('forecast-product').value=selected;
  if(!byId('forecast-window').dataset.ready){byId('forecast-window').value=store.settings.window;byId('forecast-window').dataset.ready='1';}
  const views={dashboard:renderSellerDashboard,products:renderSellerProducts,orders:renderSellerOrders,messages:renderSellerMessages,inventory:renderSellerInventory,analytics:renderSellerAnalytics,forecast:renderSellerForecast,vouchers:renderSellerVouchers,settings:renderSellerSettings};views[page]();window.scrollTo(0,0);
}
// Combine completed-sales KPIs, historical revenue, pending orders, and stock alerts.
function renderSellerDashboard() {
  const current=metrics(store,30,0,new Date(),sellerId()),previous=metrics(store,30,30,new Date(),sellerId()),products=sellerProducts(),low=products.filter(p=>p.active&&getInventorySummary(p).low),pending=store.orders.filter(o=>o.status==='Pending'&&sellerOrder(o)).length;
  byId('dashboard-kpis').innerHTML=renderKpis(current,previous);byId('dashboard-chart').innerHTML=renderChart(series(store,null,'daily',30,new Date(),sellerId()));
  byId('dashboard-best').innerHTML=renderRankingBars(current.orders);
  byId('attention-list').innerHTML=summaryLine('Orders to process',pending)+summaryLine('Stock alerts',low.length)+summaryLine('Active products',products.filter(p=>p.active).length)+summaryLine('Total inventory',products.reduce((n,p)=>n+p.stock,0));
  byId('dashboard-stock').innerHTML=low.slice(0,5).map(p=>`<div class="stock-row"><div><strong>${escapeHtml(p.name)}</strong>
    <small>${p.stock} on hand · ROP ${getInventorySummary(p).rop}</small></div>${actionButton('Restock','restock',p.id)}</div>`).join('')||'<p class="green">Inventory looks healthy.</p>';
}
// Render catalog rows with current stock, completed sales, and edit actions.
function renderSellerProducts() { byId('products-table').innerHTML=sellerProducts().map(p=>`<tr><td><div class="table-product">
    <img loading="lazy" decoding="async" src="${escapeHtml(getProductImage(p))}" alt=""><span><strong>${escapeHtml(p.name)}</strong><small>Sold by ${escapeHtml(getCurrentUser().name)}</small></span></div></td><td>${escapeHtml(p.category)}</td><td>${formatCurrency(p.price)}</td><td>${p.stock}</td><td>${getUnitsSold(p.id)}</td><td>${renderStatusBadge(p.active?'Active':'Inactive')}</td><td>${actionButton('Edit','edit-product',p.id)}${actionButton(p.active?'Deactivate':'Activate','toggle-product',p.id)}${actionButton('Delete','delete-product',p.id)}</td></tr>`).join('')||'<tr><td colspan="7">No products yet. Add your first product to begin.</td></tr>'; }
// Filter by status and show the sixty most recent matching order snapshots.
function renderSellerOrders() { const filter=byId('order-filter').value,orders=store.orders.filter(o=>sellerOrder(o)&&(filter==='All'||o.status===filter)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  byId('orders-table').innerHTML=orders.slice(0,60).map(o=>`<tr><td><strong>${escapeHtml(o.id.slice(0,18))}</strong>
    <small>${formatDate(o.date)}</small></td><td>${escapeHtml(o.customer)}</td><td>${o.items.reduce((n,i)=>n+i.qty,0)}</td><td>${formatCurrency(o.total)}</td><td>${escapeHtml(o.payment)}</td><td>${renderStatusBadge(o.status)}</td><td>${actionButton('View order','order-detail',o.id)}</td></tr>`).join('')||'<tr><td colspan="7">No orders with this status.</td></tr>'; }
// Show the shared forecast policy beside current stock and adjustment history.
function renderSellerInventory() {
  byId('inventory-table').innerHTML=sellerProducts().filter(p=>p.active).map(p=>{const v=getInventorySummary(p);
  return `<tr><td><strong>${escapeHtml(p.name)}</strong>
    <small>${escapeHtml(p.supplier)}</small></td><td>${p.stock}</td><td>${v.noData?'No sales yet':`${formatNumber(v.daily)} / ${formatNumber(v.weekly)}`}</td><td>${p.lead} days / ${p.safety}</td><td>${v.noData?'—':v.rop}</td><td>${renderStatusBadge(v.noData?'No sales':p.stock<=v.rop?'Reorder':v.low?'Low':'Healthy')}</td><td>${v.noData?'—':v.reorder||'—'}</td><td>${actionButton('Restock','restock',p.id)}${actionButton('Parameters','edit-product',p.id)}</td></tr>`;}).join('');
  byId('adjustment-list').innerHTML=store.adjustments.filter(a=>sellerProducts().some(p=>p.id===a.productId)).slice().reverse().slice(0,20).map(a=>`<div class="adjustment-row">
    <span>${formatDate(a.date)} · ${escapeHtml(store.products.find(p=>p.id===a.productId)?.name||a.productId)}</span><strong>${a.qty>0?'+':''}${a.qty}</strong>
    <small>${escapeHtml(a.reason)}</small></div>`).join('');
}
// Calculate the series once and reuse it for both the graph and its accessible data table.
function renderSellerAnalytics() {
  const days=+byId('analytics-days').value,current=metrics(store,days,0,new Date(),sellerId()),previous=metrics(store,days,days,new Date(),sellerId()),period=byId('chart-period').value,key=byId('chart-metric').value,count=period==='daily'?Math.min(days,30):period==='weekly'?Math.min(26,Math.ceil(days/7)):6;
  const data=series(store,null,period,count,new Date(),sellerId());byId('analytics-kpis').innerHTML=renderKpis(current,previous);
  byId('analytics-chart').innerHTML=renderChart(data,key);
  byId('chart-description').textContent=`${count} complete ${period==='daily'?'days':period==='weekly'?'weeks':'months'}. Current partial period excluded. Revenue includes order discounts and excludes delivery.`;
  byId('chart-data').innerHTML=`<table><thead><tr><th>Starting</th><th>Revenue</th><th>Units</th><th>Completed orders</th></tr></thead>
    <tbody>${data.map(d=>`<tr><td>${d.date}</td><td>${formatCurrency(d.revenue)}</td><td>${d.units}</td><td>${d.orders}</td></tr>`).join('')}</tbody></table>`;
  byId('best-products').innerHTML=renderRankingBars(current.orders);byId('category-performance').innerHTML=renderRankingBars(current.orders,true);
  byId('voucher-summary').textContent=`${current.orders.filter(o=>o.vouchers?.length).length} completed orders used vouchers. Order discounts: ${formatCurrency(current.orders.reduce((n,o)=>n+o.discount,0))}. Shipping discounts: ${formatCurrency(current.orders.reduce((n,o)=>n+o.shippingDiscount,0))}.`;
}
// Show customer conversations and keep the selected thread open after refreshes.
function renderSellerMessages() { const select=byId('chat-customer'),selected=select.value,customers=store.users.filter(u=>u.role==='customer'&&store.chats.some(m=>m.userId===u.id));
  select.innerHTML=customers.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)}</option>`).join('');if(customers.some(u=>u.id===selected))select.value=selected;
  const id=select.value,user=currentUser(store,id);byId('seller-chat-form').elements.customerId.value=id||'';byId('seller-chat-title').textContent=store.shop.name;byId('seller-chat-avatar').textContent=store.shop.name[0]||'S';byId('seller-chat-subtitle').textContent=user?`Conversation with ${user.name}`:'Choose a customer to reply';byId('seller-chat').innerHTML=id?renderChatMessages(id,true):'<p class="muted">Customer messages will appear here.</p>';byId('seller-chat').scrollTop=byId('seller-chat').scrollHeight; }
// The preview uses the same replenishment function as inventory; no duplicate ROP formula.
function renderSellerForecast() { const p=sellerProducts().find(p=>p.id===byId('forecast-product').value),button=byId('forecast-restock');
  if(!p){byId('forecast-kpis').innerHTML='';byId('forecast-chart').innerHTML='';byId('forecast-action').textContent='Add a product to see demand insights.';button.disabled=true;return;}
  const f=forecast(store,p.id,+byId('forecast-window').value,new Date(),sellerId()),hasSales=f.history.some(w=>w.units);button.dataset.id=p.id;button.disabled=!hasSales;
  byId('forecast-chart').innerHTML=renderChart(f.history,'units',f.future);
  if(!hasSales){byId('forecast-kpis').innerHTML=renderKpiCard('Sales recorded','0 units','Completed orders')+renderKpiCard('Current stock',p.stock,'Units on hand')+renderKpiCard('Next action','Wait for sales','Recommendations start after your first order');byId('forecast-action').textContent='After your first completed order, Shopay will estimate next week’s demand and recommend a restock amount.';return;}
  const v=replenishment(p,f.future);byId('forecast-kpis').innerHTML=renderKpiCard('Next week forecast',formatNumber(f.future)+' units',`${byId('forecast-window').value}-week average`)+renderKpiCard('Stock on hand',p.stock,`Reorder point: ${v.rop}`)+renderKpiCard('Suggested reorder',v.reorder+' units',`Target stock: ${v.target}`);
  byId('forecast-action').textContent=v.reorder?`Order ${v.reorder} units of ${p.name} to reach ${v.target} units, including lead time and safety stock.`:`No restock needed. ${p.stock} units are above the ${v.rop}-unit reorder point.`; }
// Show saved offers and their remaining uses without changing eligibility rules.
function renderSellerVouchers() { byId('vouchers-table').innerHTML=store.vouchers.map(v=>`<tr><td><strong>${escapeHtml(v.code)}</strong></td><td>${v.type==='percent'?v.value+'%':formatCurrency(v.value)} ${escapeHtml(v.type)}</td><td>${formatCurrency(v.min)}</td><td>${formatCurrency(v.max)}</td><td>${formatDate(v.expires+'T12:00:00')}</td><td>${v.remaining}</td><td>${actionButton('Edit','edit-voucher',v.id)}${actionButton('Disable','disable-voucher',v.id)}</td></tr>`).join(''); }
function renderSellerSettings() { fillForm(byId('settings-form'),{...store.shop,...store.settings}); } // Reuse the simple form filler.
function fillForm(form,values) { form.reset();for(const [name,value]of Object.entries(values)){const field=form.elements.namedItem(name==='id'?'recordId':name);
  if(field)field.value=value??'';} } // DOM values do not need HTML parsing.
// Fill the product form with an existing record or simple new-product defaults.
function openProductDialog(id='') { const p=store.products.find(p=>p.id===id)||{id:'',name:'',category:'Electronics',stock:10,price:100,original:150,image:'',description:'',specs:'Standard edition',supplier:'Shopay Supply Co.',lead:7,safety:10,minimum:5};
  fillForm(byId('product-form'),{...p,image:normalizeImageSource(p.image)||''});
  byId('product-dialog-title').textContent=id?'Edit your good find':'Add a good find';byId('product-dialog').showModal(); }
// Prefill a positive replenishment quantity while leaving final choice to the seller.
function openInventoryDialog(id) { const p=store.products.find(p=>p.id===id),v=getInventorySummary(p);fillForm(byId('stock-form'),{id,qty:v.reorder||10});
  byId('stock-product').textContent=`${p.name} · ${p.stock} on hand · Suggested replenishment ${v.reorder}`;byId('stock-dialog').showModal(); }
// Fill the voucher form for either a new code or an existing offer.
function openVoucherDialog(id='') { const v=store.vouchers.find(v=>v.id===id)||{id:'',code:'',type:'percent',value:10,min:500,max:250,remaining:50,expires:dateKey(new Date(Date.now()+30*86400000))};
  fillForm(byId('voucher-form'),v);byId('voucher-dialog').showModal(); }
// Display the order snapshots and offer only permitted next statuses.
function openOrderDialog(id) { const o=store.orders.find(o=>o.id===id),form=byId('status-form');
  byId('order-details').innerHTML=renderOrderCard(o);form.elements.recordId.value=id;
  form.hidden=!STATUSES[o.status].length;
  form.elements.status.innerHTML=STATUSES[o.status].map(s=>`<option>${s}</option>`).join('');byId('order-dialog').showModal(); }
function completeDialogAction(message) { document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  initializeAdmin();showToast(message); } // One shared save-completion path.
// All seller buttons use one listener and one role check.
function handleAdminClick(event) {
  const b=event.target.closest('[data-admin]');if(!b||getCurrentUser()?.role!=='seller')return;const action=b.dataset.admin,id=b.dataset.id;
  try {
    if(action==='close-dialog'){b.closest('dialog').close();return;}if(action==='new-product'||action==='edit-product'){openProductDialog(id);return;
  }if(action==='restock'||action==='restock-forecast'){openInventoryDialog(id);return;}if(action==='new-voucher'||action==='edit-voucher'){openVoucherDialog(id);
  return;}if(action==='order-detail'){openOrderDialog(id);return;}
    if(action==='delete-product'){if(!confirm('Delete this product from the catalog? Past order records will remain.'))return;updateState(data=>{data.products=data.products.filter(p=>p.id!==id);data.reviews=data.reviews.filter(r=>r.productId!==id);data.adjustments=data.adjustments.filter(a=>a.productId!==id);Object.keys(data.carts).forEach(user=>data.carts[user]=data.carts[user].filter(i=>i.productId!==id));});initializeAdmin();return;}
    if(action==='toggle-product')updateState(data=>{const p=data.products.find(p=>p.id===id);p.active=!p.active;});
    if(action==='disable-voucher')updateState(data=>data.vouchers.find(v=>v.id===id).remaining=0);
    if(action==='save-window'){updateState(data=>data.settings.window=+byId('forecast-window').value);
  showToast('Inventory now uses the selected forecast window.');}initializeAdmin();
  } catch(error){showToast(error.message);}
}
// Native field constraints and shared validation both run before seller records are saved.
function handleAdminSubmit(event) {
  const form=event.target;if(!['product-form','stock-form','voucher-form','status-form','settings-form','seller-chat-form'].includes(form.id))return;
  event.preventDefault();if(getCurrentUser()?.role!=='seller')return;const d=Object.fromEntries(new FormData(form));
  try {
    if(form.id==='seller-chat-form'){const user=currentUser(store,d.customerId);if(!user||user.role!=='customer')throw Error('Choose a customer conversation first.');updateState(data=>addChatMessage(data,user.id,d.text,getCurrentUser()));form.reset();initializeAdmin();return;}
    if(form.id==='product-form'){if(d.image&&!normalizeImageSource(d.image))throw Error('Use a direct HTTP or HTTPS image URL.');
  if(+d.original<+d.price)throw Error('Original price must be at least the selling price.');
  updateState(data=>{const old=data.products.find(p=>p.id===d.recordId),p={...(old||{id:uid('p'),shopId:data.shop.id,sellerId:sellerId(),active:true,flash:false,created:new Date().toISOString()}),name:d.name.trim(),category:d.category,price:+d.price,original:+d.original,stock:+d.stock,image:d.image.trim(),variants:d.variants.trim(),description:d.description.trim(),specs:d.specs.trim(),supplier:d.supplier.trim(),lead:+d.lead,safety:+d.safety,minimum:+d.minimum};
  if(!p.name)throw Error('Enter a product name.');const difference=p.stock-(old?.stock||0);
  if(old&&difference)data.adjustments.push({id:uid('ADJ'),productId:p.id,qty:difference,date:new Date().toISOString(),reason:'Manual product stock edit'});
  if(old)data.products[data.products.findIndex(p=>p.id===d.recordId)]=p;else data.products.push(p);
  });completeDialogAction('Product saved. Customer listings are updated.');return;}
    if(form.id==='stock-form'){updateState(data=>restock(data,d.recordId,+d.qty));completeDialogAction('Restocked. Availability is updated.');return;}
    if(form.id==='status-form'){updateState(data=>updateOrderStatus(data,d.recordId,d.status));
  completeDialogAction(d.status==='Completed'?'Completed. Sales analytics are updated.':'Order tracking updated.');return;}
    if(form.id==='voucher-form'){if(d.type==='percent'&&+d.value>100)throw Error('Percentage discounts cannot exceed 100%.');
  updateState(data=>{const code=d.code.trim().toUpperCase();if(data.vouchers.some(v=>v.code===code&&v.id!==d.recordId))throw Error('Voucher code already exists.');
  const v={id:d.recordId||uid('v'),shopId:data.shop.id,code,type:d.type,value:+d.value,min:+d.min,max:+d.max,remaining:+d.remaining,expires:d.expires};
  if(d.recordId)data.vouchers[data.vouchers.findIndex(v=>v.id===d.recordId)]=v;else data.vouchers.push(v);});completeDialogAction('Voucher saved.');return;}
    if(form.id==='settings-form'){updateState(data=>{data.shop.name=d.name.trim();data.shop.tagline=d.tagline.trim();data.settings.courier=d.courier.trim();
  data.settings.standard=+d.standard;data.settings.express=+d.express;});initializeAdmin();showToast('Shop settings saved.');}
  } catch(error){showToast(error.message);}
}
function handleAdminChange(event) { if(getCurrentUser()?.role!=='seller')return;const id=event.target.id;if(id==='order-filter')renderSellerOrders();if(id==='chat-customer')renderSellerMessages();
  if(id==='product-image-file'){const file=event.target.files[0];if(!file)return;if(file.size>1024*1024){showToast('Choose an image smaller than 1 MB.');event.target.value='';return;}const reader=new FileReader();reader.onload=()=>byId('product-form').elements.image.value=reader.result;reader.readAsDataURL(file);}
  if(['analytics-days','chart-period','chart-metric'].includes(id))renderSellerAnalytics();if(['forecast-product','forecast-window'].includes(id))renderSellerForecast(); } // Refresh the affected view only.
document.addEventListener('click',handleAdminClick);
document.addEventListener('submit',handleAdminSubmit);
document.addEventListener('change',handleAdminChange);


