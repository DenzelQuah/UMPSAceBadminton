CREATE POLICY "Organizers can create groups" ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ));

CREATE POLICY "Organizers can create group members" ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ));

CREATE POLICY "Organizers can create matches" ON public.matches
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ));