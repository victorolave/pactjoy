-- ADR-0019: account erasure is distinct from ordinary circle departure.
alter table pactjoy.circle_members
  add column erased_at timestamptz,
  add constraint circle_members_erased_shape check (erased_at is null or status = 'left');
