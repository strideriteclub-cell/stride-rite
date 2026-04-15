-- Supabase Database Setup for Stride Rite

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS public.stride_users (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    age TEXT,
    gender TEXT,
    level TEXT,
    is_admin BOOLEAN DEFAULT FALSE
);

-- 2. Create Runs Table
CREATE TABLE IF NOT EXISTS public.stride_runs (
    id UUID PRIMARY KEY,
    date_label TEXT NOT NULL,
    location TEXT NOT NULL,
    location_link TEXT NOT NULL,
    description TEXT NOT NULL,
    created_by TEXT NOT NULL
);

-- 3. Create Registrations Table
CREATE TABLE IF NOT EXISTS public.stride_registrations (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    user_id UUID NOT NULL,
    distance TEXT NOT NULL,
    level TEXT NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Disable Row Level Security (RLS) to allow frontend access
-- WARNING: This is for simplified community apps. Anyone with the anon key can read/write.
ALTER TABLE public.stride_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stride_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stride_registrations DISABLE ROW LEVEL SECURITY;

-- 5. Insert Default Admin User
INSERT INTO public.stride_users (id, name, email, password, is_admin)
VALUES (
    gen_random_uuid(), 
    'Admin Haleem', 
    'tsmhaleem@gmail.com', 
    'haleem@147', 
    TRUE
) ON CONFLICT (email) DO NOTHING;
