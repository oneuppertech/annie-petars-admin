create extension if not exists pgcrypto;

create type public.app_role as enum ('owner','admin','catalog_manager','order_manager','support');
create type public.product_status as enum ('draft','active','archived');
create type public.order_status as enum ('pending_payment','paid','processing','ready_to_ship','shipped','delivered','cancelled','refunded');
create type public.payment_status as enum ('unpaid','pending','paid','failed','refunded','partially_refunded');
create type public.custom_request_status as enum ('new','reviewing','quoted','awaiting_customer','approved','in_production','completed','declined','cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'support',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.has_shop_role(allowed public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = any(allowed));
$$;

-- Bootstrap an owner by running this from SQL Editor as database owner for the first admin.
-- After bootstrap, only an owner may grant roles through this function.
create or replace function public.set_user_role(target_user uuid, target_role public.app_role)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_shop_role(array['owner']::public.app_role[]) then
    raise exception 'Only an owner can assign roles';
  end if;
  insert into public.user_roles(user_id, role) values(target_user, target_role)
  on conflict(user_id) do update set role=excluded.role, updated_at=now();
end $$;

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  tagline text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references public.collections(id) on delete set null,
  name text not null,
  slug text not null unique,
  sku text unique,
  short_description text,
  description text,
  fabric text,
  care_instructions text,
  product_type text not null default 'ready_to_wear',
  status public.product_status not null default 'draft',
  currency char(3) not null default 'NGN',
  price_kobo bigint not null check(price_kobo >= 0),
  compare_at_price_kobo bigint check(compare_at_price_kobo is null or compare_at_price_kobo >= 0),
  is_customisable boolean not null default false,
  is_featured boolean not null default false,
  is_new_arrival boolean not null default false,
  allow_backorder boolean not null default false,
  published_at timestamptz,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order int not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique,
  size text,
  colour text,
  option_values jsonb not null default '{}'::jsonb,
  price_kobo bigint check(price_kobo is null or price_kobo >= 0),
  stock_quantity int not null default 0 check(stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, size, colour)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_email_idx on public.customers(lower(email));

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text default 'Shipping',
  recipient_name text not null,
  phone text,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state_region text,
  postal_code text,
  country_code char(2) not null default 'NG',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('AP-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10))),
  customer_id uuid references public.customers(id) on delete set null,
  email text not null,
  phone text,
  status public.order_status not null default 'pending_payment',
  payment_status public.payment_status not null default 'unpaid',
  currency char(3) not null default 'NGN',
  subtotal_kobo bigint not null default 0 check(subtotal_kobo >= 0),
  shipping_kobo bigint not null default 0 check(shipping_kobo >= 0),
  discount_kobo bigint not null default 0 check(discount_kobo >= 0),
  total_kobo bigint not null default 0 check(total_kobo >= 0),
  shipping_address jsonb not null default '{}'::jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  customer_note text,
  internal_note text,
  tracking_number text,
  shipping_provider text,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_idx on public.orders(status, placed_at desc);
create index orders_email_idx on public.orders(lower(email));

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  sku text,
  size text,
  colour text,
  quantity int not null check(quantity > 0),
  unit_price_kobo bigint not null check(unit_price_kobo >= 0),
  line_total_kobo bigint not null check(line_total_kobo >= 0),
  product_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_reference text unique,
  status public.payment_status not null default 'pending',
  amount_kobo bigint not null check(amount_kobo >= 0),
  currency char(3) not null default 'NGN',
  raw_response jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default ('APC-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10))),
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  country text,
  outfit_type text not null,
  garment_type text not null default 'dress',
  fabric_preference text,
  colour_preference text,
  needed_by date,
  measurement_unit text not null default 'cm' check(measurement_unit in ('cm','in')),
  measurements jsonb not null default '{}'::jsonb,
  notes text,
  event_date date,
  quantity int not null default 1 check(quantity > 0),
  status public.custom_request_status not null default 'new',
  quote_kobo bigint check(quote_kobo is null or quote_kobo >= 0),
  internal_notes text,
  agreed_timeline text,
  terms_accepted boolean not null default false,
  accuracy_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_requests_status_idx on public.custom_requests(status, created_at desc);

create table public.custom_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_requests(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  enquiry_type text not null default 'General enquiry',
  message text not null,
  status text not null default 'new' check(status in ('new','in_progress','resolved','spam')),
  internal_notes text,
  created_at timestamptz not null default now()
);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'subscribed' check(status in ('subscribed','unsubscribed')),
  source text default 'website',
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create table public.shop_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Timestamp trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','user_roles','collections','products','product_variants','customers','orders','custom_requests','shop_settings'] loop
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- Signup profile. Role is NOT automatically elevated.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name) values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into public.user_roles(user_id, role) values(new.id, 'support') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Public catalog RPC returns only active/published data.
create or replace function public.get_public_catalog(
  p_collection_slug text default null,
  p_search text default null,
  p_featured_only boolean default false,
  p_limit int default 24,
  p_offset int default 0
)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'collections', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order, c.name)
      from public.collections c where c.is_active), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'sku', p.sku,
      'short_description', p.short_description, 'description', p.description,
      'fabric', p.fabric, 'care_instructions', p.care_instructions,
      'currency', p.currency, 'price_kobo', p.price_kobo,
      'compare_at_price_kobo', p.compare_at_price_kobo,
      'is_customisable', p.is_customisable, 'is_featured', p.is_featured,
      'is_new_arrival', p.is_new_arrival, 'collection_id', p.collection_id,
      'collection', (select jsonb_build_object('name',c.name,'slug',c.slug) from public.collections c where c.id=p.collection_id),
      'images', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.product_images i where i.product_id=p.id),'[]'::jsonb),
      'variants', coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'size',v.size,'colour',v.colour,'price_kobo',v.price_kobo,'stock_quantity',v.stock_quantity,'sku',v.sku) order by v.size)
        from public.product_variants v where v.product_id=p.id and v.is_active),'[]'::jsonb)
    ) order by p.is_featured desc, p.published_at desc nulls last)
      from public.products p left join public.collections c on c.id=p.collection_id
      where p.status='active'
        and (p_collection_slug is null or c.slug=p_collection_slug)
        and (p_featured_only=false or p.is_featured)
        and (p_search is null or p.name ilike '%'||p_search||'%' or p.description ilike '%'||p_search||'%')
      limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset)), '[]'::jsonb)
  );
$$;

-- Private bucket for customer measurement/reference uploads. The Edge Function uses service role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('custom-request-files','custom-request-files',false,8388608,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

-- RLS: browser can read published catalogue; mutations are server-side/admin-only.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.custom_requests enable row level security;
alter table public.custom_request_files enable row level security;
alter table public.contact_messages enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.shop_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "public read active collections" on public.collections for select using (is_active);
create policy "public read active products" on public.products for select using (status='active');
create policy "public read images for active products" on public.product_images for select using (exists(select 1 from public.products p where p.id=product_id and p.status='active'));
create policy "public read active variants" on public.product_variants for select using (is_active and exists(select 1 from public.products p where p.id=product_id and p.status='active'));
create policy "users read own profile" on public.profiles for select to authenticated using (id=auth.uid());
create policy "users update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "users read own role" on public.user_roles for select to authenticated using (user_id=auth.uid());

-- Admin table access is deliberately performed through authenticated Edge Functions
-- using service-role client after an explicit role check, not direct browser writes.
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.customers from anon, authenticated;
revoke all on public.customer_addresses from anon, authenticated;
revoke all on public.custom_requests from anon, authenticated;
revoke all on public.custom_request_files from anon, authenticated;
revoke all on public.contact_messages from anon, authenticated;
revoke all on public.newsletter_subscribers from anon, authenticated;
revoke all on public.shop_settings from anon, authenticated;
