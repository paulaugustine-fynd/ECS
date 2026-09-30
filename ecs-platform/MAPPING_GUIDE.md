# Brand/location preparation and evidence

This checkpoint uses the local Fynd simulator only. None of its identifiers or acknowledgements establishes actual Fynd connectivity. See `FYND_CONNECTION_PLAN.md` for the separate, disabled read-only connection probe and tenant prerequisites.

## Operator workflow

1. Review the partner's compliance, commercial agreement and effective territorial brand rights.
2. Use **Locations → Add location** to configure an AE warehouse/store, owner, delivery cities, Dubai cut-off hour and daily capacity. Vendors have a scoped read-only list. ATI partner managers, operations managers and admins may configure locations; ownership and market cannot be changed on an existing record.
3. In **Partners & brands → Review**, synchronize the ERP vendor identity, then request **Map Fynd**. A separate durable command is created for each effective brand/market and each required active location.
4. Refresh readiness and expand mapping evidence. Passing requires a successful mock-mode acknowledgement, matching current configuration fingerprint and durable downstream read-back. Location IDs must match the acknowledged ID. Seeded Boolean flags and standalone IDs do not pass.
5. Publish the assortment, reconcile stock, complete the isolated launch-order test and separately activate. A successful mapping alone does not publish products or activate a partner.

## Invalidation and recovery

Location edits increment their version and clear the old ID. Adding a mandatory location, changing configuration, or changing effective brand rights invalidates relevant preparation. The conservative current policy gates the entire partner's new-order availability until all required mappings are current. Physical stock, reservations and existing fulfilment legs remain untouched. Zero availability is sent through revisioned inventory jobs.

Request **Map Fynd** again after correcting the configuration. Current requests receive stable simulator identifiers; new request versions can repair downstream drift. Old queued configurations are rejected before dispatch and checked again at acknowledgement. Successful historical commands cannot satisfy a changed fingerprint. Existing launch-order evidence can become stale after mapping changes; rerun the isolated test when its prerequisites are ready.

Shared ATI warehouse mappings use a common location key, while each partner still needs its own successful provisioning evidence. Only ATI warehouses that contain that partner's stock join its required location set.

## Verified scope and gaps

- Four new PostgreSQL integration tests cover idempotent location creation, denied vendor writes/CSRF/arbitrary IDs, isolated vendor reads, Boolean/ID forgery, downstream drift recovery, stable mapping identity, stale configuration/version rejection, unchanged stock buckets and immediate availability gating.
- Browser verification created Atelier Noor Dubai Warehouse and progressed Noor from ERP pending/mappings 0/2 to acknowledged ERP and mappings 2/2. Catalogue, inventory and launch-test prerequisites correctly remain pending.
- AE configuration only; complete addresses, geographical validation, further markets/localization and actual tenant-bound Fynd API adapters are not delivered here. Local mock identifiers must never be used as real Fynd identifiers.
