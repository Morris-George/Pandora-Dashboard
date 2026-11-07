-- A courier company's AWB (typed by the packer) or our own AWB can only be on one bag
create unique index if not exists dispatch_batches_seal_unique on dispatch_batches (upper(seal_no));
