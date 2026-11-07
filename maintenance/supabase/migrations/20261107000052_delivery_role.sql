-- New role: Courier ('delivery') carries sealed bags between the stores and HQ (every store).
-- The existing 'courier' role is the Area Manager again (assigned stores).
alter type app_role add value if not exists 'delivery';
