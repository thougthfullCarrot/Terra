-- Schedule the collector every 2 hours.
--
-- pg_cron cannot run TypeScript, so it calls the API's POST /v1/collect over
-- pg_net. The endpoint and the shared secret live in Supabase Vault rather than
-- in this file, so the migration is safe to commit.
--
-- One-time setup, run once per project with your own values:
--
--   select vault.create_secret('https://api.yourapp.dev/v1/collect', 'collector_url');
--   select vault.create_secret('<COLLECTOR_SECRET>', 'collector_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function trigger_collector() returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  url    text;
  secret text;
begin
  select decrypted_secret into url    from vault.decrypted_secrets where name = 'collector_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'collector_secret';

  if url is null or secret is null then
    raise warning 'collector_url or collector_secret missing from vault; skipping run';
    return;
  end if;

  perform net.http_post(
    url     := url,
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-collector-secret', secret),
    body    := '{}'::jsonb,
    -- A full pass over 30 boards takes well under a minute, but the timeout is
    -- generous so a slow board does not kill the run.
    timeout_milliseconds := 120000
  );
end;
$$;

select cron.unschedule('terra-collect') where exists (
  select 1 from cron.job where jobname = 'terra-collect'
);

select cron.schedule('terra-collect', '0 */2 * * *', $$select trigger_collector()$$);

-- Verify with:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select * from net._http_response order by created desc limit 10;
