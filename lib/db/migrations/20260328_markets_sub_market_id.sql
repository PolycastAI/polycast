-- Optional nested Polymarket/Gamma market id for multi-outcome parent events.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sub_market_id TEXT;

create or replace function reset_and_insert_shortlist(new_markets jsonb)
returns void
language plpgsql
as $$
declare
  cleared_market_ids uuid[];
begin
  select array_agg(id) into cleared_market_ids
  from markets
  where status in ('pending', 'held');

  if cleared_market_ids is not null then
    delete from predictions where market_id = ANY(cleared_market_ids);
    delete from market_prices where market_id = ANY(cleared_market_ids);
    delete from re_run_schedule where market_id = ANY(cleared_market_ids);
    delete from sensitivity_tests where market_id = ANY(cleared_market_ids);
  end if;

  delete from held_markets where true;
  delete from markets where status in ('pending', 'held');

  insert into markets (
    polymarket_id,
    sub_market_id,
    title,
    category,
    market_geography,
    resolution_date,
    resolution_criteria,
    market_url,
    status,
    current_price,
    volume
  )
  select
    (m->>'polymarket_id')::text,
    nullif(m->>'sub_market_id', '')::text,
    m->>'title',
    nullif(m->>'category', '')::text,
    nullif(m->>'market_geography', '')::text,
    case
      when m ? 'resolution_date' and m->>'resolution_date' is not null and m->>'resolution_date' <> ''
      then (m->>'resolution_date')::timestamptz
      else null
    end,
    nullif(m->>'resolution_criteria', '')::text,
    nullif(m->>'market_url', '')::text,
    'pending',
    case
      when m ? 'current_price' and m->>'current_price' <> '' then (m->>'current_price')::numeric
      else null
    end,
    case
      when m ? 'volume' and m->>'volume' <> '' then (m->>'volume')::numeric
      else null
    end
  from jsonb_array_elements(new_markets) as m;
end;
$$;
