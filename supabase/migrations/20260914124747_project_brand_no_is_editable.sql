-- brand_no shows on the project page's Client tab and was left out of the
-- grants, which would have made it the one box on that tab that refuses.
grant insert (brand_no), update (brand_no) on xano_mirror.project_master_list to authenticated;
