select json_build_object(
  'testers', (select count(*) from private.watch_testers),
  'tester_fingerprints', (select json_agg(left(encode(extensions.digest(user_id::text, 'sha256'), 'hex'), 12)) from private.watch_testers),
  'beta_settings', (select row_to_json(s) from private.watch_settings s),
  'profiles', (select count(*) from public.profiles),
  'watch_emails_on', (select count(*) from public.profiles where watch_emails),
  'job_alerts_on', (select count(*) from public.profiles where email_alerts),
  'watchlist_items', (select json_agg(json_build_object('kind', kind, 'city', city, 'ref', ref, 'created', created_at) order by created_at) from public.watchlist_items),
  'watch_sends', (select count(*) from public.watch_sends),
  'watch_digests', (select count(*) from public.watch_digests),
  'watch_recipients', (select count(*) from public.watch_recipients()),
  'subscriptions', (select json_agg(json_build_object('status', status, 'n', n)) from (select status, count(*) n from public.subscriptions group by status) x),
  'alert_sends_last', (select max(sent_at) from public.alert_sends),
  'history', (select json_agg(json_build_object('day', day, 'v', data->>'v', 'bytes', octet_length(data::text), 'followed_bytes', octet_length(coalesce(data->'followed', '{}'::jsonb)::text), 'followed_keys', (select count(*) from jsonb_object_keys(coalesce(data->'followed', '{}'::jsonb))), 'rr_followed', data->'followed'->'TABS2025026208', 'rr_on_map', data->'projects' ? 'TABS2025026208') order by day) from public.market_history),
  'history_rows_per_day_max', (select max(c) from (select count(*) c from public.market_history group by day) y),
  'db_bytes', pg_database_size(current_database()),
  'market_history_bytes', pg_total_relation_size('public.market_history')
) as report;
