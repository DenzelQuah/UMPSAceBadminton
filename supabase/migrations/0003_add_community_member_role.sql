-- Add is_community_member to profiles table
ALTER TABLE public.profiles ADD COLUMN is_community_member BOOLEAN NOT NULL DEFAULT FALSE;

-- Update RLS policies for profiles
-- Allow admins to update all profiles
CREATE POLICY "Profiles: Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Allow community members to see all profiles (needed for assigning officials)
CREATE POLICY "Profiles: Community members can select all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (is_admin = true OR is_community_member = true)));

-- Allow all authenticated users to see basic profile info of others (needed for public brackets/player lists)
-- We'll modify the existing policy or add a new one.
-- Existing policy: "Profiles: Allow users to select their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY "Profiles: Allow users to select their own profile" ON public.profiles;
CREATE POLICY "Profiles: Allow authenticated users to select all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);
