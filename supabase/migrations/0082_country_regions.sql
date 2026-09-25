-- 24 Sep 2026. Which region each country is in, so the roster form asks only
-- for the country and the team's region follows (Andy). Sequel's five regions:
-- 1 Asia Pacific, 2 Europe, 3 Latin America, 4 North America, 5 Africa, Middle
-- East & Turkey. Mexico, Central America and the Caribbean are Latin America;
-- the Middle East and Turkey are region 5. App-owned (countries_list is still
-- mirrored from Xano); read by the roster-onboarding function only.
create table if not exists public.track_country_regions (
  country_id integer primary key,
  region_id integer not null check (region_id between 1 and 5)
);
alter table public.track_country_regions enable row level security;
revoke all on public.track_country_regions from anon, authenticated;
insert into public.track_country_regions (country_id, region_id) values
(1,1),(2,2),(3,5),(4,2),(5,5),(6,3),(7,3),(8,2),(9,1),(10,2),(11,2),(12,3),(13,5),(14,1),(15,3),(16,2),(17,2),(18,3),(19,5),(20,1),(21,3),(22,2),(23,5),(24,3),(25,1),(26,2),(27,5),(28,5),(29,5),(30,1),(31,5),(32,4),(33,5),(34,5),(35,3),(36,1),(37,3),(38,5),(39,5),(40,3),(41,2),(42,3),(43,2),(44,2),(45,5),(46,2),(47,5),(48,3),(49,3),(50,3),(51,5),(52,3),(53,5),(54,5),(55,2),(56,5),(57,5),(58,1),(59,2),(60,2),(61,5),(62,5),(63,2),(64,2),(65,5),(66,2),(67,3),(68,3),(69,5),(70,5),(71,3),(72,3),(73,2),(74,3),(75,2),(76,2),(77,1),(78,1),(79,5),(80,5),(81,2),(82,5),(83,2),(84,3),(85,1),(86,5),(87,1),(88,5),(89,1),(90,5),(91,1),(92,1),(93,2),(94,5),(95,5),(96,5),(97,5),(98,2),(99,2),(100,2),(101,5),(102,5),(103,1),(104,1),(105,5),(106,2),(107,1),(108,5),(109,5),(110,3),(111,1),(112,2),(113,2),(114,1),(115,2),(116,5),(117,5),(118,1),(119,5),(120,1),(121,1),(122,2),(123,1),(124,3),(125,5),(126,5),(127,1),(128,2),(129,2),(130,5),(131,1),(132,1),(133,5),(134,3),(135,1),(136,3),(137,3),(138,1),(139,2),(140,2),(141,5),(142,2),(143,2),(144,5),(145,3),(146,3),(147,3),(148,1),(149,2),(150,5),(151,5),(152,5),(153,2),(154,5),(155,5),(156,1),(157,2),(158,2),(159,1),(160,5),(161,5),(162,1),(163,5),(164,2),(165,1),(166,5),(167,3),(168,2),(169,2),(170,5),(171,1),(172,5),(173,1),(174,1),(175,5),(176,1),(177,3),(178,5),(179,5),(180,1),(181,1),(182,5),(183,2),(184,5),(185,2),(186,4),(187,3),(188,1),(189,1),(190,3),(191,1),(192,5),(193,5),(194,5),(195,2)
on conflict (country_id) do update set region_id = excluded.region_id;
