CREATE POLICY "Organizers can update category status" ON public.categories
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = TRUE OR is_community_member = TRUE)
  ));