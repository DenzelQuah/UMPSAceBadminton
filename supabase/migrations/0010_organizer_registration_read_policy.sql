CREATE POLICY "Organizers can view category registrations" ON public.registrations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ));