-- Can the signed-in user see this project?
-- Staff see everything. A client user sees a project if it belongs to their company,
-- or they are named on it as the client contact or the adpro user.
create or replace function public.track_can_see_project(p_project bigint)
returns boolean
language sql stable security definer set search_path = public, xano_mirror, pg_catalog as $fn$
  select public.track_is_staff()
      or exists (
           select 1 from xano_mirror.project_master_list p
            where p.id = p_project
              and ( (p.client_agency  is not null and p.client_agency  = public.track_company_id())
                 or (p.client_user_id is not null and p.client_user_id = public.track_user_id())
                 or (p.adpro_user     is not null and p.adpro_user     = public.track_user_id()) ));
$fn$;
revoke execute on function public.track_can_see_project(bigint) from anon, public;
grant  execute on function public.track_can_see_project(bigint) to authenticated;

grant usage on schema xano_mirror to authenticated;

alter table xano_mirror."brand_category" enable row level security;
revoke all on xano_mirror."brand_category" from anon, authenticated;
grant select on xano_mirror."brand_category" to authenticated;
alter table xano_mirror."client_types" enable row level security;
revoke all on xano_mirror."client_types" from anon, authenticated;
grant select on xano_mirror."client_types" to authenticated;
alter table xano_mirror."contract_types" enable row level security;
revoke all on xano_mirror."contract_types" from anon, authenticated;
grant select on xano_mirror."contract_types" to authenticated;
alter table xano_mirror."countries_list" enable row level security;
revoke all on xano_mirror."countries_list" from anon, authenticated;
grant select on xano_mirror."countries_list" to authenticated;
alter table xano_mirror."currencies_bank_accounts" enable row level security;
revoke all on xano_mirror."currencies_bank_accounts" from anon, authenticated;
grant select on xano_mirror."currencies_bank_accounts" to authenticated;
alter table xano_mirror."fee_categories" enable row level security;
revoke all on xano_mirror."fee_categories" from anon, authenticated;
grant select on xano_mirror."fee_categories" to authenticated;
alter table xano_mirror."projects_status_options" enable row level security;
revoke all on xano_mirror."projects_status_options" from anon, authenticated;
grant select on xano_mirror."projects_status_options" to authenticated;
alter table xano_mirror."regions" enable row level security;
revoke all on xano_mirror."regions" from anon, authenticated;
grant select on xano_mirror."regions" to authenticated;
alter table xano_mirror."services" enable row level security;
revoke all on xano_mirror."services" from anon, authenticated;
grant select on xano_mirror."services" to authenticated;
alter table xano_mirror."user_statuses" enable row level security;
revoke all on xano_mirror."user_statuses" from anon, authenticated;
grant select on xano_mirror."user_statuses" to authenticated;
alter table xano_mirror."user_types" enable row level security;
revoke all on xano_mirror."user_types" from anon, authenticated;
grant select on xano_mirror."user_types" to authenticated;
alter table xano_mirror."project_master_list" enable row level security;
revoke all on xano_mirror."project_master_list" from anon, authenticated;
grant select on xano_mirror."project_master_list" to authenticated;
alter table xano_mirror."briefs" enable row level security;
revoke all on xano_mirror."briefs" from anon, authenticated;
grant select on xano_mirror."briefs" to authenticated;
alter table xano_mirror."contracts" enable row level security;
revoke all on xano_mirror."contracts" from anon, authenticated;
grant select on xano_mirror."contracts" to authenticated;
alter table xano_mirror."creative_links" enable row level security;
revoke all on xano_mirror."creative_links" from anon, authenticated;
grant select on xano_mirror."creative_links" to authenticated;
alter table xano_mirror."project_assets" enable row level security;
revoke all on xano_mirror."project_assets" from anon, authenticated;
grant select on xano_mirror."project_assets" to authenticated;
alter table xano_mirror."quotes" enable row level security;
revoke all on xano_mirror."quotes" from anon, authenticated;
grant select on xano_mirror."quotes" to authenticated;
alter table xano_mirror."sequel_songs" enable row level security;
revoke all on xano_mirror."sequel_songs" from anon, authenticated;
grant select on xano_mirror."sequel_songs" to authenticated;
alter table xano_mirror."invoices" enable row level security;
revoke all on xano_mirror."invoices" from anon, authenticated;
grant select on xano_mirror."invoices" to authenticated;
alter table xano_mirror."quote_line_items" enable row level security;
revoke all on xano_mirror."quote_line_items" from anon, authenticated;
grant select on xano_mirror."quote_line_items" to authenticated;
alter table xano_mirror."invoice_line_items" enable row level security;
revoke all on xano_mirror."invoice_line_items" from anon, authenticated;
grant select on xano_mirror."invoice_line_items" to authenticated;
alter table xano_mirror."adpro_usage_backfill" enable row level security;
revoke all on xano_mirror."adpro_usage_backfill" from anon, authenticated;
grant select on xano_mirror."adpro_usage_backfill" to authenticated;
alter table xano_mirror."agent_conversation" enable row level security;
revoke all on xano_mirror."agent_conversation" from anon, authenticated;
grant select on xano_mirror."agent_conversation" to authenticated;
alter table xano_mirror."agent_message" enable row level security;
revoke all on xano_mirror."agent_message" from anon, authenticated;
grant select on xano_mirror."agent_message" to authenticated;
alter table xano_mirror."ai_prompts" enable row level security;
revoke all on xano_mirror."ai_prompts" from anon, authenticated;
grant select on xano_mirror."ai_prompts" to authenticated;
alter table xano_mirror."client_groups" enable row level security;
revoke all on xano_mirror."client_groups" from anon, authenticated;
grant select on xano_mirror."client_groups" to authenticated;
alter table xano_mirror."event_log" enable row level security;
revoke all on xano_mirror."event_log" from anon, authenticated;
grant select on xano_mirror."event_log" to authenticated;
alter table xano_mirror."fx_rates" enable row level security;
revoke all on xano_mirror."fx_rates" from anon, authenticated;
grant select on xano_mirror."fx_rates" to authenticated;
alter table xano_mirror."image_assets" enable row level security;
revoke all on xano_mirror."image_assets" from anon, authenticated;
grant select on xano_mirror."image_assets" to authenticated;
alter table xano_mirror."invoice_documents" enable row level security;
revoke all on xano_mirror."invoice_documents" from anon, authenticated;
grant select on xano_mirror."invoice_documents" to authenticated;
alter table xano_mirror."invoices_import" enable row level security;
revoke all on xano_mirror."invoices_import" from anon, authenticated;
grant select on xano_mirror."invoices_import" to authenticated;
alter table xano_mirror."mcps_rate_card" enable row level security;
revoke all on xano_mirror."mcps_rate_card" from anon, authenticated;
grant select on xano_mirror."mcps_rate_card" to authenticated;
alter table xano_mirror."quickbooks_connection" enable row level security;
revoke all on xano_mirror."quickbooks_connection" from anon, authenticated;
grant select on xano_mirror."quickbooks_connection" to authenticated;
alter table xano_mirror."rate_limits" enable row level security;
revoke all on xano_mirror."rate_limits" from anon, authenticated;
grant select on xano_mirror."rate_limits" to authenticated;
alter table xano_mirror."region_uplifts" enable row level security;
revoke all on xano_mirror."region_uplifts" from anon, authenticated;
grant select on xano_mirror."region_uplifts" to authenticated;
alter table xano_mirror."sequel_track_invoices" enable row level security;
revoke all on xano_mirror."sequel_track_invoices" from anon, authenticated;
grant select on xano_mirror."sequel_track_invoices" to authenticated;
alter table xano_mirror."sequel_track_quotes_dont_use" enable row level security;
revoke all on xano_mirror."sequel_track_quotes_dont_use" from anon, authenticated;
grant select on xano_mirror."sequel_track_quotes_dont_use" to authenticated;
alter table xano_mirror."sequel_song_writer" enable row level security;
revoke all on xano_mirror."sequel_song_writer" from anon, authenticated;
grant select on xano_mirror."sequel_song_writer" to authenticated;
alter table xano_mirror."sequel_writers" enable row level security;
revoke all on xano_mirror."sequel_writers" from anon, authenticated;
grant select on xano_mirror."sequel_writers" to authenticated;
alter table xano_mirror."short_link" enable row level security;
revoke all on xano_mirror."short_link" from anon, authenticated;
grant select on xano_mirror."short_link" to authenticated;
alter table xano_mirror."song_backfill" enable row level security;
revoke all on xano_mirror."song_backfill" from anon, authenticated;
grant select on xano_mirror."song_backfill" to authenticated;
alter table xano_mirror."supplier_list" enable row level security;
revoke all on xano_mirror."supplier_list" from anon, authenticated;
grant select on xano_mirror."supplier_list" to authenticated;
alter table xano_mirror."unilever_commerical_search_fees" enable row level security;
revoke all on xano_mirror."unilever_commerical_search_fees" from anon, authenticated;
grant select on xano_mirror."unilever_commerical_search_fees" to authenticated;
alter table xano_mirror."unilever_library_search_fees" enable row level security;
revoke all on xano_mirror."unilever_library_search_fees" from anon, authenticated;
grant select on xano_mirror."unilever_library_search_fees" to authenticated;
alter table xano_mirror."unilever_minimum_licensing_fees" enable row level security;
revoke all on xano_mirror."unilever_minimum_licensing_fees" from anon, authenticated;
grant select on xano_mirror."unilever_minimum_licensing_fees" to authenticated;
alter table xano_mirror."user" enable row level security;
revoke all on xano_mirror."user" from anon, authenticated;
grant select on xano_mirror."user" to authenticated;
alter table xano_mirror."clients" enable row level security;
revoke all on xano_mirror."clients" from anon, authenticated;
grant select on xano_mirror."clients" to authenticated;
alter table xano_mirror."notifications" enable row level security;
revoke all on xano_mirror."notifications" from anon, authenticated;
grant select on xano_mirror."notifications" to authenticated;

-- Lookup tables: any signed-in user may read
create policy brand_category_read on xano_mirror."brand_category" for select to authenticated using (true);
create policy client_types_read on xano_mirror."client_types" for select to authenticated using (true);
create policy contract_types_read on xano_mirror."contract_types" for select to authenticated using (true);
create policy countries_list_read on xano_mirror."countries_list" for select to authenticated using (true);
create policy currencies_bank_accounts_read on xano_mirror."currencies_bank_accounts" for select to authenticated using (true);
create policy fee_categories_read on xano_mirror."fee_categories" for select to authenticated using (true);
create policy projects_status_options_read on xano_mirror."projects_status_options" for select to authenticated using (true);
create policy regions_read on xano_mirror."regions" for select to authenticated using (true);
create policy services_read on xano_mirror."services" for select to authenticated using (true);
create policy user_statuses_read on xano_mirror."user_statuses" for select to authenticated using (true);
create policy user_types_read on xano_mirror."user_types" for select to authenticated using (true);

-- Staff-only tables
create policy adpro_usage_backfill_staff_read on xano_mirror."adpro_usage_backfill" for select to authenticated using (public.track_is_staff());
create policy agent_conversation_staff_read on xano_mirror."agent_conversation" for select to authenticated using (public.track_is_staff());
create policy agent_message_staff_read on xano_mirror."agent_message" for select to authenticated using (public.track_is_staff());
create policy ai_prompts_staff_read on xano_mirror."ai_prompts" for select to authenticated using (public.track_is_staff());
create policy client_groups_staff_read on xano_mirror."client_groups" for select to authenticated using (public.track_is_staff());
create policy event_log_staff_read on xano_mirror."event_log" for select to authenticated using (public.track_is_staff());
create policy fx_rates_staff_read on xano_mirror."fx_rates" for select to authenticated using (public.track_is_staff());
create policy image_assets_staff_read on xano_mirror."image_assets" for select to authenticated using (public.track_is_staff());
create policy invoice_documents_staff_read on xano_mirror."invoice_documents" for select to authenticated using (public.track_is_staff());
create policy invoices_import_staff_read on xano_mirror."invoices_import" for select to authenticated using (public.track_is_staff());
create policy mcps_rate_card_staff_read on xano_mirror."mcps_rate_card" for select to authenticated using (public.track_is_staff());
create policy quickbooks_connection_staff_read on xano_mirror."quickbooks_connection" for select to authenticated using (public.track_is_staff());
create policy rate_limits_staff_read on xano_mirror."rate_limits" for select to authenticated using (public.track_is_staff());
create policy region_uplifts_staff_read on xano_mirror."region_uplifts" for select to authenticated using (public.track_is_staff());
create policy sequel_track_invoices_staff_read on xano_mirror."sequel_track_invoices" for select to authenticated using (public.track_is_staff());
create policy sequel_track_quotes_dont_use_staff_read on xano_mirror."sequel_track_quotes_dont_use" for select to authenticated using (public.track_is_staff());
create policy sequel_song_writer_staff_read on xano_mirror."sequel_song_writer" for select to authenticated using (public.track_is_staff());
create policy sequel_writers_staff_read on xano_mirror."sequel_writers" for select to authenticated using (public.track_is_staff());
create policy short_link_staff_read on xano_mirror."short_link" for select to authenticated using (public.track_is_staff());
create policy song_backfill_staff_read on xano_mirror."song_backfill" for select to authenticated using (public.track_is_staff());
create policy supplier_list_staff_read on xano_mirror."supplier_list" for select to authenticated using (public.track_is_staff());
create policy unilever_commerical_search_fees_staff_read on xano_mirror."unilever_commerical_search_fees" for select to authenticated using (public.track_is_staff());
create policy unilever_library_search_fees_staff_read on xano_mirror."unilever_library_search_fees" for select to authenticated using (public.track_is_staff());
create policy unilever_minimum_licensing_fees_staff_read on xano_mirror."unilever_minimum_licensing_fees" for select to authenticated using (public.track_is_staff());
create policy user_staff_read on xano_mirror."user" for select to authenticated using (public.track_is_staff());

-- Project-scoped tables
create policy project_master_list_scoped_read on xano_mirror."project_master_list" for select to authenticated using (public.track_can_see_project(id));
create policy briefs_scoped_read on xano_mirror."briefs" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy contracts_scoped_read on xano_mirror."contracts" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy creative_links_scoped_read on xano_mirror."creative_links" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy project_assets_scoped_read on xano_mirror."project_assets" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy quotes_scoped_read on xano_mirror."quotes" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy sequel_songs_scoped_read on xano_mirror."sequel_songs" for select to authenticated using (public.track_can_see_project(project_master_list_id));
create policy invoices_scoped_read on xano_mirror."invoices" for select to authenticated using (public.track_can_see_project(project_master_list_id));

-- Line items, scoped through their parent
create policy quote_line_items_scoped_read on xano_mirror."quote_line_items" for select to authenticated using (public.track_is_staff() or exists (select 1 from xano_mirror.quotes p where p.id = quote_id and public.track_can_see_project(p.project_master_list_id)));
create policy invoice_line_items_scoped_read on xano_mirror."invoice_line_items" for select to authenticated using (public.track_is_staff() or exists (select 1 from xano_mirror.invoices p where p.id = invoice_id and public.track_can_see_project(p.project_master_list_id)));

-- Special cases
create policy clients_read on xano_mirror."clients" for select to authenticated using (public.track_is_staff() or id = public.track_company_id());
create policy notifications_read on xano_mirror."notifications" for select to authenticated using (public.track_is_staff() or user_id = public.track_user_id());

