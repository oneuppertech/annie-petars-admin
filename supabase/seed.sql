insert into public.collections(name,slug,description,tagline,image_url,sort_order,is_active) values
('Annie’s Ready-to-Wear (A-RTW)','ready-to-wear','Contemporary fashion for everyday life, social gatherings and work-related occasions.','Everyday style, thoughtfully designed.','/assets/rtw.png',1,true),
('Contemporary African Suits','african-suits','African-inspired textiles and design details through modern tailoring.','African heritage meets modern tailoring.','/assets/contemporary.png',2,true),
('Focus on the Bride','bridal','Bridal designs shaped around personal vision, fit and occasion.','Designed for one of life’s meaningful moments.','/assets/fob.png',3,true),
('Aso Ebi Special','aso-ebi','Coordinated dressing for weddings, birthdays and memorable gatherings.','Together in style, united by tradition.','/assets/aso-ebi.png',4,true),
('Made-to-Measure Designs','made-to-measure','Personalised designs discussed and agreed before production.','Your measurements. Your preferences. Your design.','/assets/mtm.png',5,true),
('Stand Official 001','stand-official-001','Polished dressing for formal engagements and professional occasions.','A distinctive expression of presence and purpose.','/assets/stand.png',6,true),
('The Girl Child Love','girl-child','Age-appropriate clothing celebrating young girls and individual style.','Celebrating young girls through fashion, care and creativity.','/assets/girl-child.png',7,true),
('New Designs, New Arrivals','new-arrivals','Recent additions to the AnniePetars range.','Fresh additions. Individual style.','/assets/new-design.png',8,true)
on conflict(slug) do update set name=excluded.name, description=excluded.description, tagline=excluded.tagline, image_url=excluded.image_url, sort_order=excluded.sort_order, is_active=true;

insert into public.products(name,slug,sku,short_description,description,product_type,status,currency,price_kobo,is_customisable,is_featured,is_new_arrival,published_at,collection_id)
select v.name,v.slug,v.sku,v.short_description,v.description,v.product_type,'active','NGN',v.price_kobo,v.is_customisable,v.is_featured,v.is_new_arrival,now(),c.id
from (values
('Signature Print Dress','signature-print-dress','AP-RTW-001','A statement print dress for expressive everyday styling.','Demo listing. Confirm exact fabric, available sizes, colour options, care instructions and stock before launch.','ready_to_wear',8500000::bigint,false,true,false),
('Contemporary Agbada Set','agbada-set','AP-SUIT-001','A contemporary African-inspired tailored set.','Demo listing. Confirm garment details, fabric, sizes and customisation availability before launch.','occasion_wear',15000000::bigint,true,true,false),
('Bridal Corset Gown','bridal-corset-gown','AP-BRD-001','A bridal design for a personal, memorable occasion.','Demo listing. Price and production timeline must be agreed with the customer before acceptance.','bridal',32000000::bigint,true,true,false),
('Aso Ebi Two-Piece','aso-ebi-two-piece','AP-ASO-001','A coordinated two-piece for celebrations and group occasions.','Demo listing. Confirm fabric sourcing, minimum quantities and production timing for group orders.','aso_ebi',7000000::bigint,true,true,false)
) as v(name,slug,sku,short_description,description,product_type,price_kobo,is_customisable,is_featured,is_new_arrival)
join public.collections c on c.slug = case v.slug
  when 'signature-print-dress' then 'ready-to-wear'
  when 'agbada-set' then 'african-suits'
  when 'bridal-corset-gown' then 'bridal'
  else 'aso-ebi' end
on conflict(slug) do update set name=excluded.name, sku=excluded.sku, short_description=excluded.short_description, description=excluded.description, price_kobo=excluded.price_kobo, collection_id=excluded.collection_id, status='active';

insert into public.product_images(product_id,image_url,alt_text,sort_order,is_primary)
select p.id, x.image_url, x.alt_text, 0, true from (values
('signature-print-dress','/assets/rtw.png','Signature Print Dress'),
('agbada-set','/assets/contemporary.png','Contemporary Agbada Set'),
('bridal-corset-gown','/assets/fob.png','Bridal Corset Gown'),
('aso-ebi-two-piece','/assets/aso-ebi.png','Aso Ebi Two-Piece')
) x(slug,image_url,alt_text) join public.products p on p.slug=x.slug
where not exists(select 1 from public.product_images i where i.product_id=p.id and i.is_primary);

insert into public.product_variants(product_id,sku,size,colour,stock_quantity,is_active)
select p.id, p.sku || '-' || v.size, v.size, 'As pictured', 0, true
from public.products p cross join (values ('S'),('M'),('L'),('XL')) v(size)
where p.slug in ('signature-print-dress','agbada-set','bridal-corset-gown','aso-ebi-two-piece')
on conflict do nothing;

insert into public.shop_settings(key,value) values
('store_profile','{"store_name":"AnniePetars","currency":"NGN","support_email":"fashion@anniepetars.com","support_phone":"+234 808 490 3580","whatsapp":"https://wa.me/2348084903580"}'::jsonb),
('shipping','{"countries":["NG","GB","US","GH"],"default_shipping_kobo":0,"note":"Configure real shipping rates before launch."}'::jsonb),
('checkout','{"payment_provider":"not_configured","accept_orders":false}'::jsonb)
on conflict(key) do nothing;
